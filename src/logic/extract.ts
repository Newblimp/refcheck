import {
  EXCL,
  isArt,
  isOrd,
  artType,
  isSignToken,
  isClaimNumber,
  SIGN_RE,
  CONNECTOR_ALT,
  RANGE_DASHES,
} from './constants.ts';
import { stem } from './stem.ts';
import { tokenize } from './tokenize.ts';
import { canonicalCumulativeTerms, cumKey } from './cumulative.ts';
import { computeClaimGraph } from './claims.ts';
import type { ClaimGraph, ClaimNumber, ClaimSpan, DepError } from './claims.ts';
import type { ArticleType, Lang, Mode } from './constants.ts';
import type { Token } from './tokenize.ts';
import type { ListTermIndex } from './listTerms.ts';
import { listExtra } from './listTerms.ts';

// ── EXTRACTION ─────────────────────────────────────────────────────────────
//
// Shape of the extraction result (the app's core data structure):
//
/** One occurrence of a sign, and the term written in front of it. */
export interface SignPosition {
  /** Char span of the term words. */
  termStart: number;
  termEnd: number;
  /** Char span of the sign itself. */
  signStart: number;
  signEnd: number;
  /** Raw lowercased term ("control unit"). */
  term: string;
  /** Stemmed term key — the identity a term is tracked under. */
  termStem: string;
  /** Sign was written as "(12)". */
  inParens: boolean;
  /**
   * The term was written without the numbering it was introduced with ("die
   * Wellen 10" for "erste Welle 10"), so `termStem` is the numbered term this
   * occurrence refers back to rather than the words under [termStart, termEnd).
   * Absent on an ordinary occurrence — see logic/cumulative.ts.
   */
  cumulative?: true;
}

/** Everything known about one reference sign. */
export interface SignEntry {
  /** termStem → occurrence count. */
  terms: Record<string, number>;
  /** One entry per occurrence. */
  positions: SignPosition[];
  /** Total occurrences. */
  count: number;
  /** Occurrences inside parentheses. */
  inPC: number;
}

/** Everything known about one term. */
export interface TermEntry {
  /** sign → occurrence count. */
  signs: Record<string, number>;
  /** Raw spellings seen for this stem. */
  rawTerms: Set<string>;
}

/**
 * One article occurrence in front of a sign-attached term — a candidate for the
 * article check, before it has been judged.
 */
export interface ArtOccurrence {
  /** The article, lowercased. */
  article: string;
  type: ArticleType;
  /** Char span of the article. */
  artStart: number;
  artEnd: number;
  /** Start of the term the article belongs to. */
  termStart: number;
  signStart: number;
  sign: string;
  termStem: string;
}

/** Which article rule was broken. */
export type ArtErrorType = 'first-def' | 'repeat-indef' | 'de-gender';

export interface ArtError extends ArtOccurrence {
  errType: ArtErrorType;
  /** de-gender only: the earlier conflicting article. */
  prevArt?: string;
}

/** A term written without its reference sign nearby. */
export interface BareTerm {
  /** Char span of the sign-less term occurrence. */
  termStart: number;
  termEnd: number;
  termStem: string;
  /** Raw lowercased term. */
  term: string;
  /** Signs this term is known under (the hint shown on the card). */
  signs: string[];
}

/** A claim number that breaks the 1, 2, 3… run. */
export interface NumError {
  /** Claim number as written. */
  value: number;
  /** Number that was expected at this position. */
  expected: number;
  /** Char span of the written number. */
  start: number;
  end: number;
  /** Edit-stable dismissal id ("value#ordinal"). */
  key: string;
}

/** Everything one pass over a buffer produces. */
export interface ExtractResult {
  signData: Record<string, SignEntry>;
  termData: Record<string, TermEntry>;
  artErrors: ArtError[];
  bareTerms: BareTerm[];
  numErrors: NumError[];
  /** Claims mode only; empty otherwise. */
  depErrors: DepError[];
  /** Signs seen only without a term. */
  noTermSigns: Set<string>;
  /** Claims mode only; null otherwise. */
  claimGraph: ClaimGraph | null;
}

/** How severe a sign's state is — drives its card and its highlight. */
export type Severity = 'warn' | 'ok';

// A number written in square brackets ([0012]) is a paragraph number, not a
// reference sign — ignore it everywhere a sign could be detected. A bracket
// directly on EITHER side counts, so every member of a bracketed group
// ([0012]-[0015], [18, 20]) is caught, not just fully enclosed tokens.
const isBracketed = (text: string, tok: Token): boolean =>
  text[tok.start - 1] === '[' || text[tok.end] === ']';

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

/**
 * One sign occurrence with its term already resolved, before the extraction
 * structures are built from it.
 *
 * The scans collect these and a second pass turns them into signData/termData/…,
 * because the cumulative-reference rule needs the whole document before it can
 * say which term a shortened occurrence belongs to: the numbered form it refers
 * back to may be written after it.
 */
interface PendingOcc {
  sign: string;
  signStart: number;
  signEnd: number;
  inParens: boolean;
  term: string;
  termStem: string;
  termStart: number;
  termEnd: number;
  /** The article in front of the WHOLE term, where the occurrence had one. */
  artTok: Token | null;
}

export function detectOrdStems(
  tokens: Token[],
  lang: Lang,
  text: string,
  isClaims: boolean
): Set<string> {
  const s = new Set<string>();
  for (let i = 2; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t || !isSignToken(t.word)) continue;
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
//
// EXCL bars a word from being the BASE NOUN — the word closest to the sign —
// not from standing in front of one. "a further 200 rivets are needed" must not
// register "further" as the term of 200, while "a further shaft 20" is a
// qualified term and belongs in the reference list as "further shaft". So an
// excluded word ends the walk unless it is a distinguishing modifier (isOrd) and
// the base noun has already been collected. Breaking on it unconditionally is
// what made "further" dead vocabulary: it sat in EN_ORD, where nothing could
// ever reach it, so "a further shaft 20" silently came back as "shaft".
function collectTermToks(
  toks: Token[],
  i: number,
  lang: Lang
): { allTT: Token[]; artTok: Token | null } {
  let j = i - 1;
  let artTok: Token | null = null;
  const allTT: Token[] = [];
  while (j >= 0 && allTT.length < MAX_TERM_WORDS) {
    const t = toks[j];
    if (!t) break;
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
    if (EXCL.has(lo) && (allTT.length === 0 || !isOrd(lo, lang))) break;
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
 */
function findBareTerms({
  toks,
  text,
  termData,
  signData,
  lang,
  isClaims,
}: {
  toks: Token[];
  text: string;
  termData: Record<string, TermEntry>;
  signData: Record<string, SignEntry>;
  lang: Lang;
  isClaims: boolean;
}): BareTerm[] {
  // Index: stem of the term's last word → [termStem, …], longest term first.
  const baseToTerms: Record<string, string[]> = {};
  for (const ts of Object.keys(termData)) {
    const parts = ts.split(' ');
    const base = parts[parts.length - 1] ?? '';
    (baseToTerms[base] ??= []).push(ts);
  }
  for (const list of Object.values(baseToTerms))
    list?.sort((a, b) => b.split(' ').length - a.split(' ').length);

  const coveredByKnownRange = buildKnownRangeIndex(signData);

  // Every token's stem, computed once — the candidate loop below indexes into
  // this instead of re-stemming the same tokens for each overlapping term.
  const stems = toks.map((t) => stem(t.word, lang));

  const bareTerms: BareTerm[] = [];
  const bareSpans = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    const s = stems[i] ?? '';
    const candidates = baseToTerms[s];
    if (!candidates) continue;
    for (const ts of candidates) {
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
      // The word-count loop above already indexed these, so both exist.
      const tStart = toks[i - (wc - 1)]?.start ?? 0,
        tEnd = toks[i]?.end ?? 0;
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
function buildKnownRangeIndex(
  signData: Record<string, SignEntry>
): (tStart: number, tEnd: number) => boolean {
  const ranges: [start: number, end: number][] = [];
  for (const sData of Object.values(signData))
    for (const p of sData.positions) ranges.push([p.termStart, p.termEnd]);
  ranges.sort((a, b) => a[0] - b[0]);
  const rangeStarts: number[] = [];
  const maxEndUpTo: number[] = [];
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
      if ((rangeStarts[mid] ?? Infinity) <= tStart) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return idx >= 0 && (maxEndUpTo[idx] ?? -1) >= tEnd;
  };
}

/**
 * Claim numbers must run 1, 2, 3… Each error carries an edit-stable key (value
 * plus its ordinal among errors with the same value) so a dismissal survives
 * edits elsewhere in the buffer.
 */
function computeNumberingErrors(claimNums: ClaimNumber[]): NumError[] {
  const numErrors: NumError[] = [];
  const keyCount: Record<number, number> = {};
  let expected = 1;
  for (const cn of claimNums) {
    if (cn.value !== expected) {
      const n = (keyCount[cn.value] = (keyCount[cn.value] ?? 0) + 1);
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
}: {
  artByTerm: Record<string, ArtOccurrence[]>;
  termPositions: Record<string, number[]>;
  termFirstPos: Record<string, number>;
  claimGraph: ClaimGraph | null;
  claimAt: (pos: number) => ClaimSpan | null;
  lang: Lang;
}): ArtError[] {
  const artErrors: ArtError[] = [];
  for (const [ts, occs] of Object.entries(artByTerm)) {
    occs.sort((a, b) => a.artStart - b.artStart);
    if (claimGraph) {
      const positions = termPositions[ts] || [];
      // Locate each position's claim ONCE rather than re-running the claimAt
      // binary search for every (occurrence, position) pair — that inner lookup
      // made a frequently-repeated term cost O(occurrences² · log claims).
      const posClaimNum: (number | null)[] = new Array(positions.length);
      for (let i = 0; i < positions.length; i++) {
        const pc = claimAt(positions[i] ?? 0);
        posClaimNum[i] = pc === null ? null : pc.num;
      }
      for (const occ of occs) {
        const c = claimAt(occ.termStart);
        const anc = c ? claimGraph.ancestors.get(c.num) : null;
        let introduced = false;
        for (let i = 0; i < positions.length; i++) {
          const p = positions[i] ?? 0;
          if (p === occ.termStart) continue;
          const pcNum = posClaimNum[i] ?? null;
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
function addGenderConflicts(occs: ArtOccurrence[], artErrors: ArtError[]): void {
  const nomDef = occs.filter((o) => DE_NOM_DEF.has(o.article));
  if (new Set(nomDef.map((o) => o.article)).size <= 1) return;
  const seen = new Set<string>();
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
 */
function findSignGroups(text: string): (start: number, end: number) => boolean {
  const groups: { start: number; end: number }[] = [];
  GROUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GROUP_RE.exec(text)) !== null) {
    // Group 1 is the bracket interior and cannot be absent when exec matched.
    const parts = (m[1] ?? '').split(GROUP_SPLIT_RE).filter(Boolean);
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
      cand: { start: number; end: number } | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = groups[mid];
      if (g && g.start < s) {
        cand = g;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return cand !== null && e < cand.end;
  };
}

/**
 * @param mwo  Manual multi-word overrides: base stem → extra words. An entry
 *   wins outright over every automatic source, including an explicit 0 — that is
 *   what "Reduce term" writes, and without it a term the reference list or the
 *   ordinal detector extends could not be reduced at all.
 * @param autoMW  Run the ordinal ("first bearing") detection
 * @param listIdx  Multi-word terms read out of the drafter's reference list
 *   (see logic/listTerms.ts)
 */
export function extractData(
  text: string,
  // Defaulted rather than required. It always was optional in practice — the
  // language only ever reaches `stem`, where anything other than 'de' means
  // English — so a call omitting it worked by accident. English is also the
  // app's own default (rsc_lang), so this states the existing behaviour instead
  // of leaving it to be inferred from a comparison three modules away.
  lang: Lang = 'en',
  mwo: Record<string, number> = {},
  autoMW = true,
  isClaims = false,
  listIdx: ListTermIndex | null = null
): ExtractResult {
  const toks = tokenize(text);
  const ordStems = autoMW ? detectOrdStems(toks, lang, text, isClaims) : new Set<string>();
  const signData: Record<string, SignEntry> = {};
  const termData: Record<string, TermEntry> = {};
  const artByTerm: Record<string, ArtOccurrence[]> = {};
  const termFirstPos: Record<string, number> = {};
  /** termStem → [termStart, …] (every sign-attached occurrence) */
  const termPositions: Record<string, number[]> = {};
  const claimNums: ClaimNumber[] = [];
  const noTermSigns = new Set<string>();
  const occs: PendingOcc[] = [];
  // Which signs the scans have already produced an occurrence for. The range
  // scan below reads this to leave an already-known sign alone; it used to ask
  // signData, which is no longer filled until the second pass.
  const seenSigns = new Set<string>();

  // Resolve the term described by `allTT` and hold the occurrence for the second
  // pass. Shared by the main scan and range detection. Pass artTok=null to skip
  // article bookkeeping (range endpoints reuse the term's already-seen article).
  function collectOccurrence(
    sign: string,
    signStart: number,
    signEnd: number,
    allTT: Token[],
    artTok: Token | null,
    inParens: boolean
  ): void {
    // Callers only reach here with a non-empty term.
    const baseW = allTT[allTT.length - 1]?.word ?? '';
    const bs = stem(baseW, lang);
    // Two automatic sources extend the term leftwards from its base noun: the
    // ordinal pattern ("first bearing" / "second bearing") and the drafter's own
    // reference list, which spells its multi-word terms out. They do not stack —
    // the wider of the two wins.
    let autoExtra = 0;
    if (ordStems.has(bs) && allTT.length >= 2 && isOrd(allTT[allTT.length - 2]?.word ?? '', lang))
      autoExtra = 1;
    if (listIdx) {
      const le = listExtra(listIdx, allTT, bs, lang);
      if (le > autoExtra) autoExtra = le;
    }
    // A manual override wins outright rather than being maxed with the
    // automatic ones, so "Reduce term" can take a term back below what the list
    // or the ordinal detector proposed. Only a non-negative number counts — a
    // corrupted localStorage value must not silently widen every term.
    const man = mwo[bs];
    const manExtra = typeof man === 'number' && man >= 0 ? Math.floor(man) : null;
    const wc = 1 + (manExtra === null ? autoExtra : manExtra);
    const termToks = allTT.slice(Math.max(0, allTT.length - wc));

    const termStr = termToks.map((t) => t.word.toLowerCase()).join(' ');
    const termStem = termToks.map((t) => stem(t.word, lang)).join(' ');
    // termToks is a non-empty slice of a non-empty allTT.
    const termStart = termToks[0]?.start ?? 0,
      termEnd = termToks[termToks.length - 1]?.end ?? 0;

    occs.push({
      sign,
      signStart,
      signEnd,
      inParens,
      term: termStr,
      termStem,
      termStart,
      termEnd,
      // An article only belongs to this term when the term is the whole phrase
      // walked back to it; a reduced term leaves the article in front of words
      // that are no longer part of it.
      artTok: artTok && termToks.length === allTT.length ? artTok : null,
    });
    seenSigns.add(sign);
  }

  /**
   * Turn the collected occurrences into the extraction structures, folding
   * cumulative back-references into the numbered term they refer to.
   */
  function buildFromOccurrences(): void {
    const canonical = canonicalCumulativeTerms(occs, lang);
    for (const o of occs) {
      const canon = canonical.get(cumKey(o.sign, o.termStem));
      const termStem = canon ?? o.termStem;

      // Held in a local rather than re-indexed: the map lookup was repeated six
      // times per occurrence, and the type now says out loud that the entry has
      // to be created before it can be written to.
      const sEntry = (signData[o.sign] ??= { terms: {}, positions: [], count: 0, inPC: 0 });
      sEntry.terms[termStem] = (sEntry.terms[termStem] ?? 0) + 1;
      sEntry.count++;
      if (o.inParens) sEntry.inPC++;
      const pos: SignPosition = {
        termStart: o.termStart,
        termEnd: o.termEnd,
        signStart: o.signStart,
        signEnd: o.signEnd,
        term: o.term,
        termStem,
        inParens: o.inParens,
      };
      if (canon !== undefined) pos.cumulative = true;
      sEntry.positions.push(pos);

      const tEntry = (termData[termStem] ??= { signs: {}, rawTerms: new Set() });
      tEntry.signs[o.sign] = (tEntry.signs[o.sign] ?? 0) + 1;

      // A cumulative occurrence is a back-reference, not a spelling of the term
      // and not an introduction of it, so it stays out of three things: the raw
      // spellings (the numbered form is what the reference list must print,
      // however often the short one is written), the article check (a plural
      // back-reference takes "die" whatever gender the singular has, which would
      // read as a der/die/das conflict), and the positions that check reads as
      // evidence of a term having been introduced.
      if (canon === undefined) {
        tEntry.rawTerms.add(o.term);
        const firstPos = termFirstPos[termStem];
        if (firstPos === undefined || o.termStart < firstPos) termFirstPos[termStem] = o.termStart;
        (termPositions[termStem] ??= []).push(o.termStart);
        if (o.artTok) {
          const al = o.artTok.word.toLowerCase();
          (artByTerm[termStem] ??= []).push({
            article: al,
            type: artType(al),
            artStart: o.artTok.start,
            artEnd: o.artTok.end,
            termStart: o.termStart,
            signStart: o.signStart,
            sign: o.sign,
            termStem,
          });
        }
      }
    }
  }

  const inParensAt = findSignGroups(text);

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (!tok || !isSignToken(tok.word)) continue;
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
    collectOccurrence(sign, signStart, signEnd, allTT, artTok, inParens);
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
  let rm: RegExpExecArray | null;
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
    while (listCur < toks.length && (toks[listCur]?.start ?? Infinity) < rm.index) listCur++;
    const baseIdx = listCur;
    const { allTT } = collectTermToks(toks, baseIdx, lang);
    if (allTT.length === 0) continue; // no shared term (e.g. "claims 1, 2 and 3") → skip
    // Pull every sign out of the matched span (connector words carry no digits).
    NUM_RE.lastIndex = 0;
    let nm: RegExpExecArray | null;
    while ((nm = NUM_RE.exec(rm[0])) !== null) {
      const sign = nm[0];
      if (!isSignToken(sign)) continue;
      const start = rm.index + nm.index;
      if (!seenSigns.has(sign))
        collectOccurrence(
          sign,
          start,
          start + sign.length,
          allTT,
          null,
          inParensAt(start, start + sign.length)
        );
    }
  }

  // Every occurrence is in hand, so the terms can be settled — see
  // buildFromOccurrences and logic/cumulative.ts.
  buildFromOccurrences();

  // ── Claim graph (claims mode) ──
  // Dependencies drive both the depErrors category and per-claim antecedent
  // checking below. Null in description mode or when no claim numbers exist.
  const claimGraph = isClaims ? computeClaimGraph(text, claimNums) : null;
  const depErrors = claimGraph ? claimGraph.depErrors : [];
  // Claim spans are in document order → binary search by position.
  const claimAt = (pos: number): ClaimSpan | null => {
    if (!claimGraph) return null;
    const spans = claimGraph.claims;
    let lo = 0,
      hi = spans.length - 1,
      found: ClaimSpan | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const span = spans[mid];
      if (span && span.start <= pos) {
        found = span;
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
/**
 * Whether a sign has anything wrong with it.
 *
 * A sign warns when it is used outside parentheses in claims mode, when it
 * carries more than one term, or when one of its terms is also used for another
 * sign.
 *
 * Note there is no `sign` parameter: this used to take one and never read it,
 * which `noUnusedParameters` surfaced during the TypeScript migration. Every
 * call site already had to pass the matching `sData` alongside it, so the
 * parameter could only ever agree or lie.
 */
export function classify(
  sData: SignEntry,
  termData: Record<string, TermEntry>,
  mode: Mode
): Severity {
  if (mode === 'claims' && sData.count > sData.inPC) return 'warn';
  if (Object.keys(sData.terms).length > 1) return 'warn';
  for (const t of Object.keys(sData.terms)) {
    const entry = termData[t];
    if (entry && Object.keys(entry.signs).length > 1) return 'warn';
  }
  return 'ok';
}
