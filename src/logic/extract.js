import { EXCL, isArt, isOrd, artType, isSignToken, isClaimNumber, SIGN_RE, disKey } from './constants.js';
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
 */

// A number written in square brackets ([0012]) is a paragraph number, not a
// reference sign — ignore it everywhere a sign could be detected. A bracket
// directly on EITHER side counts, so every member of a bracketed group
// ([0012]-[0015], [18, 20]) is caught, not just fully enclosed tokens.
const isBracketed = (text, tok) => text[tok.start - 1] === '[' || text[tok.end] === ']';

export function detectOrdStems(tokens, lang, text, isClaims) {
  const s = new Set();
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (!isSignToken(t.word)) continue;
    if (isBracketed(text, t)) continue;
    if (isClaims && isClaimNumber(text, t)) continue;
    const p1 = tokens[i - 1], p2 = tokens[i - 2];
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
  let j = i - 1, artTok = null;
  const allTT = [];
  while (j >= 0 && allTT.length < 5) {
    const t = toks[j];
    const lo = t.word.toLowerCase();
    if (/^\d/.test(t.word)) break;
    if (isArt(lo, lang)) { artTok = t; break; }
    if (t.word.length < 2) { j--; continue; }
    if (EXCL.has(lo)) break;
    allTT.unshift(t);
    j--;
  }
  return { allTT, artTok };
}

/** @returns {ExtractResult} */
export function extractData(text, lang, mwo = {}, autoMW = true, isClaims = false) {
  const toks = tokenize(text);
  const ordStems = autoMW ? detectOrdStems(toks, lang, text, isClaims) : new Set();
  const signData = {}, termData = {}, artByTerm = {}, termFirstPos = {};
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
    if (ordStems.has(bs) && allTT.length >= 2 && isOrd(allTT[allTT.length - 2].word, lang)) autoExtra = 1;
    const wc = 1 + Math.max(manExtra, autoExtra);
    const termToks = allTT.slice(Math.max(0, allTT.length - wc));

    const termStr = termToks.map(t => t.word.toLowerCase()).join(' ');
    const termStem = termToks.map(t => stem(t.word, lang)).join(' ');
    const termStart = termToks[0].start, termEnd = termToks[termToks.length - 1].end;

    if (!signData[sign]) signData[sign] = { terms: {}, positions: [], count: 0, inPC: 0 };
    signData[sign].terms[termStem] = (signData[sign].terms[termStem] || 0) + 1;
    signData[sign].count++;
    if (inParens) signData[sign].inPC++;
    signData[sign].positions.push({ termStart, termEnd, signStart, signEnd, term: termStr, termStem, inParens });

    if (!termData[termStem]) termData[termStem] = { signs: {}, rawTerms: new Set() };
    termData[termStem].signs[sign] = (termData[termStem].signs[sign] || 0) + 1;
    termData[termStem].rawTerms.add(termStr);

    if (termFirstPos[termStem] === undefined || termStart < termFirstPos[termStem])
      termFirstPos[termStem] = termStart;
    (termPositions[termStem] || (termPositions[termStem] = [])).push(termStart);

    if (artTok && termToks.length === allTT.length) {
      const al = artTok.word.toLowerCase();
      if (!artByTerm[termStem]) artByTerm[termStem] = [];
      artByTerm[termStem].push({ article: al, type: artType(al), artStart: artTok.start, artEnd: artTok.end, termStart, signStart, sign, termStem });
    }
  }

  // Parenthesized sign groups: a "(…)" (no nested parens) whose interior is only
  // reference signs separated by spaces, commas or semicolons — "(10)",
  // "(6, 12; 13)". Every sign inside such a group counts as written in
  // parentheses for the claims-mode check, even though a "," or ";" sits between
  // it and the enclosing brackets. A group holding any non-sign word ("(see 10)")
  // does not qualify, so signs there stay unparenthesised.
  const signGroups = [];
  const GROUP_RE = /\(([^()]*)\)/g;
  let gmatch;
  while ((gmatch = GROUP_RE.exec(text)) !== null) {
    const parts = gmatch[1].split(/[\s,;]+/).filter(Boolean);
    if (parts.length && parts.every(isSignToken))
      signGroups.push({ start: gmatch.index, end: gmatch.index + gmatch[0].length });
  }
  const inParensAt = (s, e) => signGroups.some(g => s > g.start && e < g.end);

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (!isSignToken(tok.word)) continue;
    if (isBracketed(text, tok)) continue; // [0012] — paragraph number, not a sign
    if (isClaims && isClaimNumber(text, tok)) {
      claimNums.push({ value: parseInt(tok.word, 10), start: tok.start, end: tok.end });
      continue;
    }
    const sign = tok.word;
    const signStart = tok.start, signEnd = tok.end;
    const inParens = inParensAt(signStart, signEnd);

    const { allTT, artTok } = collectTermToks(toks, i, lang);
    if (allTT.length === 0) { noTermSigns.add(sign); continue; }
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
  const SEP = `\\s*(?:[,;]\\s*(?:and|und|to|bis)?|and|und|to|bis|[-–—])\\s*`;
  const LIST_RE = new RegExp(`(${SIGN_RE})(?:${SEP}(?:${SIGN_RE}))+`, 'gi');
  const NUM_RE = new RegExp(SIGN_RE, 'g');
  let rm;
  while ((rm = LIST_RE.exec(text)) !== null) {
    // A fully bracketed list/range ([12-14], [18, 20]) is a paragraph-number
    // construct, not signs. (A separator can never cross a "]"/"[", so a list
    // match cannot otherwise touch bracketed numbers.)
    if (text[rm.index - 1] === '[' && text[rm.index + rm[0].length] === ']') continue;
    // Index of the first token at/after the list start; the shared term is
    // whatever precedes it (works whether or not the endpoints tokenized).
    let baseIdx = toks.findIndex(t => t.start >= rm.index);
    if (baseIdx < 0) baseIdx = toks.length;
    const { allTT } = collectTermToks(toks, baseIdx, lang);
    if (allTT.length === 0) continue; // no shared term (e.g. "claims 1, 2 and 3") → skip
    // Pull every sign out of the matched span (connector words carry no digits).
    NUM_RE.lastIndex = 0;
    let nm;
    while ((nm = NUM_RE.exec(rm[0])) !== null) {
      const sign = nm[0];
      if (!isSignToken(sign)) continue;
      const start = rm.index + nm.index;
      if (!signData[sign]) recordOccurrence(sign, start, start + sign.length, allTT, null, inParensAt(start, start + sign.length));
    }
  }

  // ── Claim graph (claims mode) ──
  // Dependencies drive both the depErrors category and per-claim antecedent
  // checking below. Null in description mode or when no claim numbers exist.
  const claimGraph = isClaims ? computeClaimGraph(text, claimNums) : null;
  const depErrors = claimGraph ? claimGraph.depErrors : [];
  // Claim spans are in document order → binary search by position.
  const claimAt = pos => {
    if (!claimGraph) return null;
    const spans = claimGraph.claims;
    let lo = 0, hi = spans.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (spans[mid].start <= pos) { found = spans[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return found; // null → before the first claim (preamble)
  };

  // ── Article errors ──
  // Description mode: "first use" is by document position — the earliest
  // occurrence of a term must take an indefinite article, later ones definite.
  // Claims mode: antecedent basis is per claim chain — a term is "introduced"
  // for an occurrence in claim C if it appeared earlier in C, anywhere in one
  // of C's ancestor claims (transitive dependencies), or in the preamble.
  const artErrors = [];
  for (const [ts, occs] of Object.entries(artByTerm)) {
    occs.sort((a, b) => a.artStart - b.artStart);
    if (claimGraph) {
      const positions = termPositions[ts] || [];
      for (const occ of occs) {
        const c = claimAt(occ.termStart);
        const anc = c ? claimGraph.ancestors.get(c.num) : null;
        const introduced = positions.some(p => {
          if (p === occ.termStart) return false;
          const pc = claimAt(p);
          if (pc === null) return true;                    // preamble introduces globally
          if (c === null) return p < occ.termStart;        // both in preamble → by position
          if (pc.num === c.num) return p < occ.termStart;  // earlier in the same claim
          return anc ? anc.has(pc.num) : false;            // anywhere in an ancestor claim
        });
        if (occ.type === 'def' && !introduced) artErrors.push({ ...occ, errType: 'first-def' });
        else if (occ.type === 'indef' && introduced) artErrors.push({ ...occ, errType: 'repeat-indef' });
      }
    } else {
      const firstTermPos = termFirstPos[ts] ?? Infinity;
      occs.forEach(occ => {
        const isFirst = occ.termStart === firstTermPos;
        if (isFirst && occ.type === 'def') artErrors.push({ ...occ, errType: 'first-def' });
        else if (!isFirst && occ.type === 'indef') artErrors.push({ ...occ, errType: 'repeat-indef' });
      });
    }
    // German gender consistency: flag if nominative def articles conflict
    if (lang === 'de') {
      const nomDef = occs.filter(o => ['der', 'die', 'das'].includes(o.article));
      if (new Set(nomDef.map(o => o.article)).size > 1) {
        const seen = new Set();
        for (const occ of nomDef) {
          if (!seen.size) { seen.add(occ.article); continue; }
          if (!seen.has(occ.article)) {
            artErrors.push({ ...occ, errType: 'de-gender', prevArt: [...seen][0] });
            seen.add(occ.article);
          }
        }
      }
    }
  }

  // ── Bare-term detection (second pass) ──
  // Build index: stem of last word → [termStem, …] sorted longest-first
  const baseToTerms = {};
  for (const ts of Object.keys(termData)) {
    const parts = ts.split(' ');
    const base = parts[parts.length - 1];
    if (!baseToTerms[base]) baseToTerms[base] = [];
    baseToTerms[base].push(ts);
  }
  for (const k of Object.keys(baseToTerms))
    baseToTerms[k].sort((a, b) => b.split(' ').length - a.split(' ').length);

  // Collect all term ranges already associated with a sign
  const knownRanges = [];
  for (const sData of Object.values(signData))
    for (const p of sData.positions) knownRanges.push([p.termStart, p.termEnd]);

  // Every token's stem, computed once — the candidate loop below indexes into
  // this instead of re-stemming the same tokens for each overlapping term.
  const stems = toks.map(t => stem(t.word, lang));

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
        if (stems[i - (wc - 1) + k] !== parts[k]) { match = false; break; }
      }
      if (!match) continue;
      const tStart = toks[i - (wc - 1)].start, tEnd = toks[i].end;
      let coveredByKnown = false;
      for (const [ks, ke] of knownRanges) { if (tStart >= ks && tEnd <= ke) { coveredByKnown = true; break; } }
      if (coveredByKnown) break;
      if (bareSpans.has(`${tStart}-${tEnd}`)) break;
      // Skip if immediately followed by a real sign token (a bracketed
      // paragraph number is not a sign, so it does not satisfy the term)
      const nxt = toks[i + 1];
      if (nxt && isSignToken(nxt.word) && !isBracketed(text, nxt) &&
        !(isClaims && isClaimNumber(text, nxt))) break;
      const signs = Object.keys(termData[ts]?.signs || {});
      bareSpans.add(`${tStart}-${tEnd}`);
      bareTerms.push({
        termStart: tStart, termEnd: tEnd, termStem: ts,
        term: toks.slice(i - (wc - 1), i + 1).map(t => t.word.toLowerCase()).join(' '), signs,
      });
      break;
    }
  }

  // ── Claim-numbering consistency (claims mode) ──
  // Each error carries an edit-stable key (value + ordinal among errors with the
  // same value) so a dismissal survives edits elsewhere in the buffer.
  const numErrors = [];
  const numKeyCount = {};
  let expected = 1;
  for (const cn of claimNums) {
    if (cn.value !== expected) {
      const n = (numKeyCount[cn.value] = (numKeyCount[cn.value] || 0) + 1);
      numErrors.push({ value: cn.value, expected, start: cn.start, end: cn.end, key: `${cn.value}#${n}` });
    }
    expected = cn.value + 1;
  }

  return { signData, termData, artErrors, bareTerms, numErrors, depErrors, noTermSigns };
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
export function getAllErrors(res, mode, dis) {
  const { signData, termData, artErrors, bareTerms, numErrors, depErrors } = res;
  const out = [];
  for (const [sign, sData] of Object.entries(signData)) {
    if (dis.has(disKey.sign(sign))) continue;
    if (classify(sign, sData, termData, mode) === 'warn')
      for (const p of sData.positions) out.push({ type: 'sign', start: p.signStart, end: p.signEnd, sign });
  }
  for (const ae of artErrors) {
    if (dis.has(disKey.art(ae.termStem))) continue;
    out.push({ type: 'art', start: ae.artStart, end: ae.artEnd, ae });
  }
  for (const bt of bareTerms) {
    if (dis.has(disKey.bare(bt.termStem))) continue;
    out.push({ type: 'bare', start: bt.termStart, end: bt.termEnd, bt });
  }
  for (const ne of numErrors) {
    if (dis.has(disKey.num(ne.key))) continue;
    out.push({ type: 'num', start: ne.start, end: ne.end, ne });
  }
  for (const de of depErrors || []) {
    if (dis.has(disKey.dep(de.key))) continue;
    out.push({ type: 'dep', start: de.start, end: de.end, de });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}
