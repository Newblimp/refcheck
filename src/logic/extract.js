import {
  EXCL,
  isArt,
  isOrd,
  artType,
  isSignToken,
  isClaimNumber,
  SIGN_RE,
  disKey,
  CONNECTOR_ALT,
  RANGE_DASHES,
} from './constants.js';
import { stem } from './stem.js';
import { tokenize } from './tokenize.js';
import { computeClaimGraph } from './claims.js';

// ── EXTRACTION ─────────────────────────────────────────────────────────────
//
// Shape of the extraction result (the app's core data structure):
//
/**
 * @typedef {Object} SignPosition
 * @property {number} termStart  Char span of the term words
 * @property {number} termEnd
 * @property {number} signStart  Char span of the sign itself
 * @property {number} signEnd
 * @property {string} term       Raw lowercased term ("control unit")
 * @property {string} termStem   Stemmed term key ("control unit" → "control unit" stems)
 * @property {boolean} inParens  Sign was written as "(12)"
 */
/**
 * @typedef {Object} SignEntry
 * @property {Object<string, number>} terms  termStem → occurrence count
 * @property {SignPosition[]} positions      One entry per occurrence
 * @property {number} count                  Total occurrences
 * @property {number} inPC                   Occurrences inside parentheses
 */
/**
 * @typedef {Object} TermEntry
 * @property {Object<string, number>} signs  sign → occurrence count
 * @property {Set<string>} rawTerms          Raw spellings seen for this stem
 */
/**
 * @typedef {Object} ArtError
 * @property {string} article    The offending article, lowercased
 * @property {'def'|'indef'} type
 * @property {number} artStart   Char span of the article
 * @property {number} artEnd
 * @property {number} termStart  Start of the term the article belongs to
 * @property {number} signStart
 * @property {string} sign
 * @property {string} termStem
 * @property {'first-def'|'repeat-indef'|'de-gender'} errType
 * @property {string} [prevArt]  de-gender only: the earlier conflicting article
 */
/**
 * @typedef {Object} BareTerm
 * @property {number} termStart  Char span of the sign-less term occurrence
 * @property {number} termEnd
 * @property {string} termStem
 * @property {string} term       Raw lowercased term
 * @property {string[]} signs    Signs this term is known under (the hint)
 */
/**
 * @typedef {Object} NumError
 * @property {number} value      Claim number as written
 * @property {number} expected   Number that was expected at this position
 * @property {number} start      Char span of the written number
 * @property {number} end
 * @property {string} key        Edit-stable dismissal id ("value#ordinal")
 */
/**
 * @typedef {Object} ExtractResult
 * @property {Object<string, SignEntry>} signData
 * @property {Object<string, TermEntry>} termData
 * @property {ArtError[]} artErrors
 * @property {BareTerm[]} bareTerms
 * @property {NumError[]} numErrors
 * @property {import('./claims.js').DepError[]} depErrors  Claims mode only
 * @property {Set<string>} noTermSigns  Signs seen only without a term
 * @property {ReturnType<import('./claims.js').computeClaimGraph>} claimGraph  Claims mode only
 */

// A number written in square brackets ([0012]) is a paragraph number, not a
// reference sign — ignore it everywhere a sign could be detected. A bracket
// directly on EITHER side counts, so every member of a bracketed group
// ([0012]-[0015], [18, 20]) is caught, not just fully enclosed tokens.
const isBracketed = (text, tok) => text[tok.start - 1] === '[' || text[tok.end] === ']';

// Scanning regexes live at module scope: none of them depend on an argument, and
// extractData runs twice per debounced keystroke, so rebuilding them per call was
// pure waste. They carry the /g flag and are driven by exec loops, so every user
// MUST reset lastIndex before looping (same contract as TOKEN_RE in tokenize.js).

// A "(…)" with no nested parens — candidate parenthesised sign group.
const GROUP_RE = /\(([^()]*)\)/g;
// Separator inside a sign range/list: "18 to 22", "18, 20 and 22", "18–22".
// The connector vocabulary is shared with the claim-reference parser — see
// CONNECTOR_ALT in constants.js.
const SEP = `\\s*(?:[,;]\\s*(?:${CONNECTOR_ALT})?|${CONNECTOR_ALT}|${RANGE_DASHES})\\s*`;
// A run of 2+ signs joined by SEP, each separator sitting directly between two
// numbers (that adjacency is what keeps "a housing 12 and a cover 14" out).
const LIST_RE = new RegExp(`(${SIGN_RE})(?:${SEP}(?:${SIGN_RE}))+`, 'gi');
// Pulls the individual signs back out of a LIST_RE match.
const NUM_RE = new RegExp(SIGN_RE, 'g');
// Interior of a candidate sign group splits on these.
const GROUP_SPLIT_RE = /[\s,;]+/;

// German nominative definite articles, for the gender-consistency check.
const DE_NOM_DEF = new Set(['der', 'die', 'das']);

// How many words back from a sign may form its term. Patent terms are short
// noun phrases ("first bearing surface"); scanning further mostly picks up
// unrelated prose, and the backward walk stops at an article or an EXCL word
// long before this in practice.
const MAX_TERM_WORDS = 5;

// Multiplier for packing a [start, end] character span into one number.
const SPAN_KEY_STRIDE = 67108864; // 2^26

export function detectOrdStems(tokens, lang, text, isClaims) {
  const s = new Set();
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isSignToken(t.word)) continue;
    if (isBracketed(text, t)) continue;
    if (isClaims && isClaimNumber(text, t)) continue;
    const p1 = tokens[i - 1],
      p2 = tokens[i - 2];
    if (!p1 || !p2) continue;
    const l1 = p1.word.toLowerCase();
    if (EXCL.has(l1) || isArt(l1, lang) || p1.word.length < 2) continue;
    if (isOrd(p2.word, lang)) s.add(stem(p1.word, lang));
  }
  return s;
}

// Walk backwards from token index `i` collecting the term tokens (and a leading
// article) that belong to the sign at `i`. Returns {allTT, artTok}.
function collectTermToks(toks, i, lang) {
  let j = i - 1,
    artTok = null;
  const allTT = [];
  while (j >= 0 && allTT.length < MAX_TERM_WORDS) {
    const t = toks[j];
    const lo = t.word.toLowerCase();
    if (/^\d/.test(t.word)) break;
    if (isArt(lo, lang)) {
      artTok = t;
      break;
    }
    if (t.word.length < 2) {
      j--;
      continue;
    }
    if (EXCL.has(lo)) break;
    allTT.unshift(t);
    j--;
  }
  return { allTT, artTok };
}

/**
 * Terms that appear without their reference sign nearby.
 *
 * A term already attached to a sign is not bare, so candidates falling inside a
 * known sign-term span are skipped, as are terms immediately followed by a real
 * sign. Longer terms win over their own suffixes ("first bearing" before
 * "bearing"), which is why the index below is sorted longest-first and the loop
 * breaks on the first match.
 *
 * @returns {BareTerm[]}
 */
function findBareTerms({ toks, text, termData, signData, lang, isClaims }) {
  // Index: stem of the term's last word → [termStem, …], longest term first.
  const baseToTerms = {};
  for (const ts of Object.keys(termData)) {
    const parts = ts.split(' ');
    const base = parts[parts.length - 1];
    if (!baseToTerms[base]) baseToTerms[base] = [];
    baseToTerms[base].push(ts);
  }
  for (const k of Object.keys(baseToTerms))
    baseToTerms[k].sort((a, b) => b.split(' ').length - a.split(' ').length);

  const coveredByKnownRange = buildKnownRangeIndex(signData);

  // Every token's stem, computed once — the candidate loop below indexes into
  // this instead of re-stemming the same tokens for each overlapping term.
  const stems = toks.map((t) => stem(t.word, lang));

  const bareTerms = [];
  const bareSpans = new Set();
  for (let i = 0; i < toks.length; i++) {
    const s = stems[i];
    if (!baseToTerms[s]) continue;
    for (const ts of baseToTerms[s]) {
      const parts = ts.split(' ');
      const wc = parts.length;
      if (i < wc - 1) continue;
      let match = true;
      for (let k = 0; k < wc; k++) {
        if (stems[i - (wc - 1) + k] !== parts[k]) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      const tStart = toks[i - (wc - 1)].start,
        tEnd = toks[i].end;
      if (coveredByKnownRange(tStart, tEnd)) break;
      // Numeric span key: avoids a string allocation per candidate. Safe while
      // documents stay under SPAN_KEY_STRIDE characters, which is ~67M.
      const spanKey = tStart * SPAN_KEY_STRIDE + tEnd;
      if (bareSpans.has(spanKey)) break;
      // Skip if immediately followed by a real sign token (a bracketed
      // paragraph number is not a sign, so it does not satisfy the term)
      const nxt = toks[i + 1];
      if (
        nxt &&
        isSignToken(nxt.word) &&
        !isBracketed(text, nxt) &&
        !(isClaims && isClaimNumber(text, nxt))
      )
        break;
      bareSpans.add(spanKey);
      bareTerms.push({
        termStart: tStart,
        termEnd: tEnd,
        termStem: ts,
        term: toks
          .slice(i - (wc - 1), i + 1)
          .map((t) => t.word.toLowerCase())
          .join(' '),
        signs: Object.keys(termData[ts]?.signs || {}),
      });
      break;
    }
  }
  return bareTerms;
}

/**
 * Build a fast "is this span inside a term already attached to a sign?" test.
 *
 * The lookup used to scan every sign-attached term span (thousands on a real
 * document) for every bare-term candidate, which is the O(occurrences²) cost
 * perf.test.js was written to watch. Sorting by start and carrying a prefix
 * maximum of the end offsets turns it into a binary search: "is there a range
 * starting at or before tStart whose end reaches tEnd?" is exactly
 * `maxEndUpTo[idx] >= tEnd`.
 *
 * (A coverage bitmap would be simpler still, but it would also treat two
 * adjacent ranges as covering a span that neither one contains.)
 */
function buildKnownRangeIndex(signData) {
  const ranges = [];
  for (const sData of Object.values(signData))
    for (const p of sData.positions) ranges.push([p.termStart, p.termEnd]);
  ranges.sort((a, b) => a[0] - b[0]);
  const rangeStarts = [];
  const maxEndUpTo = [];
  let running = -1;
  for (const [ks, ke] of ranges) {
    rangeStarts.push(ks);
    running = running > ke ? running : ke;
    maxEndUpTo.push(running);
  }
  return (tStart, tEnd) => {
    let lo = 0,
      hi = rangeStarts.length - 1,
      idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rangeStarts[mid] <= tStart) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return idx >= 0 && maxEndUpTo[idx] >= tEnd;
  };
}

/**
 * Claim numbers must run 1, 2, 3… Each error carries an edit-stable key (value
 * plus its ordinal among errors with the same value) so a dismissal survives
 * edits elsewhere in the buffer.
 * @returns {NumError[]}
 */
function computeNumberingErrors(claimNums) {
  const numErrors = [];
  const keyCount = {};
  let expected = 1;
  for (const cn of claimNums) {
    if (cn.value !== expected) {
      const n = (keyCount[cn.value] = (keyCount[cn.value] || 0) + 1);
      numErrors.push({
        value: cn.value,
        expected,
        start: cn.start,
        end: cn.end,
        key: `${cn.value}#${n}`,
      });
    }
    expected = cn.value + 1;
  }
  return numErrors;
}

/**
 * Article-usage errors for every term that was seen with an article.
 *
 * Description mode: "first use" is by document position — the earliest
 * occurrence of a term must take an indefinite article, later ones definite.
 *
 * Claims mode: this becomes an antecedent-basis check, evaluated per claim
 * chain rather than by position. A term is "introduced" for an occurrence in
 * claim C if it appeared earlier in C, anywhere in one of C's ancestor claims
 * (transitive dependencies), or in the preamble before the first claim. That is
 * what lets a second independent claim correctly re-introduce "a device" while
 * "the seal" in a dependent claim whose chain never mentioned a seal is flagged.
 *
 * German gender consistency (der/die/das) is checked in both modes.
 *
 * @returns {ArtError[]}
 */
function computeArticleErrors({
  artByTerm,
  termPositions,
  termFirstPos,
  claimGraph,
  claimAt,
  lang,
}) {
  const artErrors = [];
  for (const [ts, occs] of Object.entries(artByTerm)) {
    occs.sort((a, b) => a.artStart - b.artStart);
    if (claimGraph) {
      const positions = termPositions[ts] || [];
      // Locate each position's claim ONCE rather than re-running the claimAt
      // binary search for every (occurrence, position) pair — that inner lookup
      // made a frequently-repeated term cost O(occurrences² · log claims).
      const posClaimNum = new Array(positions.length);
      for (let i = 0; i < positions.length; i++) {
        const pc = claimAt(positions[i]);
        posClaimNum[i] = pc === null ? null : pc.num;
      }
      for (const occ of occs) {
        const c = claimAt(occ.termStart);
        const anc = c ? claimGraph.ancestors.get(c.num) : null;
        let introduced = false;
        for (let i = 0; i < positions.length; i++) {
          const p = positions[i];
          if (p === occ.termStart) continue;
          const pcNum = posClaimNum[i];
          const hit =
            pcNum === null
              ? true // preamble introduces globally
              : c === null
                ? p < occ.termStart // both in preamble → by position
                : pcNum === c.num
                  ? p < occ.termStart // earlier in the same claim
                  : anc
                    ? anc.has(pcNum) // anywhere in an ancestor claim
                    : false;
          if (hit) {
            introduced = true;
            break;
          }
        }
        if (occ.type === 'def' && !introduced) artErrors.push({ ...occ, errType: 'first-def' });
        else if (occ.type === 'indef' && introduced)
          artErrors.push({ ...occ, errType: 'repeat-indef' });
      }
    } else {
      const firstTermPos = termFirstPos[ts] ?? Infinity;
      occs.forEach((occ) => {
        const isFirst = occ.termStart === firstTermPos;
        if (isFirst && occ.type === 'def') artErrors.push({ ...occ, errType: 'first-def' });
        else if (!isFirst && occ.type === 'indef')
          artErrors.push({ ...occ, errType: 'repeat-indef' });
      });
    }
    if (lang === 'de') addGenderConflicts(occs, artErrors);
  }
  return artErrors;
}

/**
 * German gender consistency: the same term taking more than one nominative
 * definite article (der/die/das) across the document is a drafting slip. The
 * first article seen wins; every later conflicting one is reported against it.
 */
function addGenderConflicts(occs, artErrors) {
  const nomDef = occs.filter((o) => DE_NOM_DEF.has(o.article));
  if (new Set(nomDef.map((o) => o.article)).size <= 1) return;
  const seen = new Set();
  for (const occ of nomDef) {
    if (!seen.size) {
      seen.add(occ.article);
      continue;
    }
    if (!seen.has(occ.article)) {
      artErrors.push({ ...occ, errType: 'de-gender', prevArt: [...seen][0] });
      seen.add(occ.article);
    }
  }
}

/**
 * Locate parenthesised sign groups and return a containment test for them.
 *
 * A group is a "(…)" with no nested parens whose interior is only reference
 * signs separated by spaces, commas or semicolons — "(10)", "(6, 12; 13)". Every
 * sign inside one counts as written in parentheses for the claims-mode check,
 * even though a "," or ";" sits between it and the enclosing brackets. A group
 * holding any non-sign word ("(see 10)") does not qualify, so signs there stay
 * unparenthesised.
 *
 * @param {string} text
 * @returns {(start: number, end: number) => boolean}
 */
function findSignGroups(text) {
  const groups = [];
  GROUP_RE.lastIndex = 0;
  let m;
  while ((m = GROUP_RE.exec(text)) !== null) {
    const parts = m[1].split(GROUP_SPLIT_RE).filter(Boolean);
    if (parts.length && parts.every(isSignToken))
      groups.push({ start: m.index, end: m.index + m[0].length });
  }
  // Groups are found in ascending `start` order and cannot nest (the pattern
  // excludes inner parens), so the only candidate containing [s,e) is the last
  // group starting before s — binary-search for it rather than scanning all of
  // them. In claims mode nearly every sign sits in a group, which made the
  // linear form effectively O(signs²).
  return (s, e) => {
    let lo = 0,
      hi = groups.length - 1,
      cand = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (groups[mid].start < s) {
        cand = groups[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return cand !== null && e < cand.end;
  };
}

/** @returns {ExtractResult} */
export function extractData(text, lang, mwo = {}, autoMW = true, isClaims = false) {
  const toks = tokenize(text);
  const ordStems = autoMW ? detectOrdStems(toks, lang, text, isClaims) : new Set();
  const signData = {},
    termData = {},
    artByTerm = {},
    termFirstPos = {};
  const termPositions = {}; // termStem → [termStart, …] (every sign-attached occurrence)
  const claimNums = [];
  const noTermSigns = new Set();

  // Record one occurrence of `sign` against the term described by `allTT`.
  // Shared by the main scan and range detection. Pass artTok=null to skip
  // article bookkeeping (range endpoints reuse the term's already-seen article).
  function recordOccurrence(sign, signStart, signEnd, allTT, artTok, inParens) {
    const baseW = allTT[allTT.length - 1].word;
    const bs = stem(baseW, lang);
    const manExtra = mwo[bs] || 0;
    let autoExtra = 0;
    if (ordStems.has(bs) && allTT.length >= 2 && isOrd(allTT[allTT.length - 2].word, lang))
      autoExtra = 1;
    // The base noun always counts; a manual override (context menu) or an
    // auto-detected ordinal pattern ("first bearing") each extend it leftwards.
    // They do not stack — the larger of the two wins.
    const wc = 1 + Math.max(manExtra, autoExtra);
    const termToks = allTT.slice(Math.max(0, allTT.length - wc));

    const termStr = termToks.map((t) => t.word.toLowerCase()).join(' ');
    const termStem = termToks.map((t) => stem(t.word, lang)).join(' ');
    const termStart = termToks[0].start,
      termEnd = termToks[termToks.length - 1].end;

    if (!signData[sign]) signData[sign] = { terms: {}, positions: [], count: 0, inPC: 0 };
    signData[sign].terms[termStem] = (signData[sign].terms[termStem] || 0) + 1;
    signData[sign].count++;
    if (inParens) signData[sign].inPC++;
    signData[sign].positions.push({
      termStart,
      termEnd,
      signStart,
      signEnd,
      term: termStr,
      termStem,
      inParens,
    });

    if (!termData[termStem]) termData[termStem] = { signs: {}, rawTerms: new Set() };
    termData[termStem].signs[sign] = (termData[termStem].signs[sign] || 0) + 1;
    termData[termStem].rawTerms.add(termStr);

    if (termFirstPos[termStem] === undefined || termStart < termFirstPos[termStem])
      termFirstPos[termStem] = termStart;
    (termPositions[termStem] || (termPositions[termStem] = [])).push(termStart);

    if (artTok && termToks.length === allTT.length) {
      const al = artTok.word.toLowerCase();
      if (!artByTerm[termStem]) artByTerm[termStem] = [];
      artByTerm[termStem].push({
        article: al,
        type: artType(al),
        artStart: artTok.start,
        artEnd: artTok.end,
        termStart,
        signStart,
        sign,
        termStem,
      });
    }
  }

  const inParensAt = findSignGroups(text);

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (!isSignToken(tok.word)) continue;
    if (isBracketed(text, tok)) continue; // [0012] — paragraph number, not a sign
    if (isClaims && isClaimNumber(text, tok)) {
      claimNums.push({ value: parseInt(tok.word, 10), start: tok.start, end: tok.end });
      continue;
    }
    const sign = tok.word;
    const signStart = tok.start,
      signEnd = tok.end;
    const inParens = inParensAt(signStart, signEnd);

    const { allTT, artTok } = collectTermToks(toks, i, lang);
    if (allTT.length === 0) {
      noTermSigns.add(sign);
      continue;
    }
    recordOccurrence(sign, signStart, signEnd, allTT, artTok, inParens);
  }

  // ── Sign ranges / lists ──
  // "18 to 22", "18 bis 22", "18 and 22", "18 und 22", "18–22", "18-22",
  // comma/semicolon lists "18, 20" / "6, 12; 13" and longer ones "18, 20 and 22"
  // / "18, 20, and 22" (Oxford), EN + DE. Every literally-listed sign is
  // registered under the single shared term preceding the list. The
  // digit-connector-digit adjacency (each separator sits directly between two
  // numbers) keeps "a housing 12 and a cover 14" (distinct terms, with a word
  // between the connector and the second number) from being misread as a list.
  LIST_RE.lastIndex = 0;
  let rm;
  // LIST_RE matches arrive in ascending rm.index and `toks` is sorted by start,
  // so the "first token at/after the list start" only ever moves forward. A
  // monotonic cursor makes the whole loop O(tokens + matches); the previous
  // toks.findIndex restarted from 0 for every match, which made a list-heavy
  // 103KB document take ~133ms against ~34ms for a comparable one without lists.
  let listCur = 0;
  while ((rm = LIST_RE.exec(text)) !== null) {
    // A fully bracketed list/range ([12-14], [18, 20]) is a paragraph-number
    // construct, not signs. (A separator can never cross a "]"/"[", so a list
    // match cannot otherwise touch bracketed numbers.)
    if (text[rm.index - 1] === '[' && text[rm.index + rm[0].length] === ']') continue;
    // Index of the first token at/after the list start; the shared term is
    // whatever precedes it (works whether or not the endpoints tokenized).
    while (listCur < toks.length && toks[listCur].start < rm.index) listCur++;
    const baseIdx = listCur;
    const { allTT } = collectTermToks(toks, baseIdx, lang);
    if (allTT.length === 0) continue; // no shared term (e.g. "claims 1, 2 and 3") → skip
    // Pull every sign out of the matched span (connector words carry no digits).
    NUM_RE.lastIndex = 0;
    let nm;
    while ((nm = NUM_RE.exec(rm[0])) !== null) {
      const sign = nm[0];
      if (!isSignToken(sign)) continue;
      const start = rm.index + nm.index;
      if (!signData[sign])
        recordOccurrence(
          sign,
          start,
          start + sign.length,
          allTT,
          null,
          inParensAt(start, start + sign.length)
        );
    }
  }

  // ── Claim graph (claims mode) ──
  // Dependencies drive both the depErrors category and per-claim antecedent
  // checking below. Null in description mode or when no claim numbers exist.
  const claimGraph = isClaims ? computeClaimGraph(text, claimNums) : null;
  const depErrors = claimGraph ? claimGraph.depErrors : [];
  // Claim spans are in document order → binary search by position.
  const claimAt = (pos) => {
    if (!claimGraph) return null;
    const spans = claimGraph.claims;
    let lo = 0,
      hi = spans.length - 1,
      found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spans[mid].start <= pos) {
        found = spans[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found; // null → before the first claim (preamble)
  };

  const artErrors = computeArticleErrors({
    artByTerm,
    termPositions,
    termFirstPos,
    claimGraph,
    claimAt,
    lang,
  });

  const bareTerms = findBareTerms({ toks, text, termData, signData, lang, isClaims });
  const numErrors = computeNumberingErrors(claimNums);

  return {
    signData,
    termData,
    artErrors,
    bareTerms,
    numErrors,
    depErrors,
    noTermSigns,
    claimGraph,
  };
}

// ── CLASSIFICATION ─────────────────────────────────────────────────────────
export function classify(sign, sData, termData, mode) {
  if (mode === 'claims' && sData.count > sData.inPC) return 'warn';
  if (Object.keys(sData.terms).length > 1) return 'warn';
  for (const t of Object.keys(sData.terms)) {
    if (termData[t] && Object.keys(termData[t].signs).length > 1) return 'warn';
  }
  return 'ok';
}

/**
 * Collect all active (non-dismissed) error positions, sorted by position, for
 * navigation and the backdrop.
 * @param {ExtractResult} res
 * @param {'description'|'claims'} mode
 * @param {Set<string>} dis  Dismissal keys (see disKey in constants.js)
 */
