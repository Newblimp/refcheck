import { stem } from './stem.ts';
import { tokenize } from './tokenize.ts';
import { parseRefList } from './refListParse.js';

// ── MULTI-WORD TERMS TAKEN FROM THE REFERENCE LIST ──────────────────────────
//
// A drafter's own list of reference signs already says which terms are
// multi-word: "30  control unit", "20  erstes Lager". The text scan cannot know
// that on its own — it walks back exactly one noun from the sign unless an
// ordinal pattern ("first bearing" / "second bearing") gives it a reason to take
// two — so "the control unit 30" was recorded as the term "unit", every listed
// multi-word term came back as a term mismatch, and the drafter had to extend
// each one by hand through the context menu.
//
// This module turns the list into an index the extraction consults: base stem →
// the listed phrases ending in that stem, longest first.
//
// The match is on the WHOLE phrase, not just the base noun. A list holding
// "control unit" does not silently turn "the drive unit 40" into a two-word
// term: the words actually written in front of the sign must stem-match the
// listed phrase. That is the difference between reading the list and guessing
// from it, and it is what makes a list mixing "unit" and "control unit" behave.
//
// Everything here is derived from the list alone, so the index is built once
// per list edit and consulted per sign occurrence — see listExtra, which is
// O(candidates with the same base noun) and touches only memoized stems.

// Longest listed phrase that can extend a term. Matches MAX_TERM_WORDS in
// extract.js: the backward walk never collects more than that, so a longer
// listed phrase could never match anything anyway.
export const MAX_LIST_TERM_WORDS = 5;

/**
 * @typedef {Object} ListTerm
 * @property {string[]} stems  Stemmed words, in written order ("control unit")
 * @property {string} key      stems.join(' ') — the same shape as a termStem
 * @property {string} term     Raw lowercased phrase, for display
 */
/**
 * @typedef {Object} ListTermIndex
 * @property {Map<string, Map<string, ListTerm[]>>} byBase  Base (last) stem →
 *   preceding stem → phrases ending in those two words, longest first. Keying on
 *   the last TWO words (rather than the base noun alone) is what keeps the
 *   lookup O(1) on a list that names three hundred different "… element"s.
 * @property {ListTerm[]} all   Every phrase, in list order
 * @property {string} sig       Content signature: equal signatures ⇒ equal index
 * @property {number} size
 */

/** Shared empty index, so "no list" costs no allocation and keeps one identity. */
const EMPTY_INDEX = { byBase: new Map(), all: [], sig: '', size: 0 };

/**
 * Build the multi-word index from a drafter's reference-sign list.
 *
 * Single-word entries are skipped: they carry no extension, and letting one
 * suppress the ordinal auto-detection would be reading more into an abbreviated
 * list than it says.
 *
 * @param {string} listText
 * @param {'en'|'de'} lang
 * @returns {ListTermIndex}
 */
export function listTermIndex(listText, lang) {
  if (!listText || !listText.trim()) return EMPTY_INDEX;
  const { entries } = parseRefList(listText);
  const byBase = new Map();
  const all = [];
  const seen = new Set();
  for (const e of entries) {
    // Tokenizing (rather than splitting on whitespace) drops the punctuation a
    // real list carries — "housing, upper" / "cover (front)" — and uses exactly
    // the word boundaries the text side will be matched with. A stray number in
    // the term ("10 housing 12") is not part of the phrase.
    const words = [];
    for (const tok of tokenize(e.term)) {
      if (/^\d/.test(tok.word)) continue;
      words.push(tok.word.toLowerCase());
    }
    if (words.length < 2 || words.length > MAX_LIST_TERM_WORDS) continue;
    const stems = words.map((w) => stem(w, lang));
    const key = stems.join(' ');
    if (seen.has(key)) continue; // same phrase listed twice (or as a plural)
    seen.add(key);
    const rec = { stems, key, term: words.join(' ') };
    all.push(rec);
    const base = stems[stems.length - 1];
    const prev = stems[stems.length - 2];
    let byPrev = byBase.get(base);
    if (!byPrev) byBase.set(base, (byPrev = new Map()));
    const at = byPrev.get(prev);
    if (at) at.push(rec);
    else byPrev.set(prev, [rec]);
  }
  if (!all.length) return EMPTY_INDEX;
  // Longest first, so the first match is the most specific one ("first bearing
  // surface" before "bearing surface").
  for (const byPrev of byBase.values())
    for (const recs of byPrev.values()) recs.sort((a, b) => b.stems.length - a.stems.length);
  return {
    byBase,
    all,
    // Sorted, so reordering the list is not a change; the caller uses this to
    // keep the index identity — and with it the memoized extraction — stable
    // while the drafter is typing in the reference-list box.
    sig: [...seen].sort().join('|'),
    size: all.length,
  };
}

/**
 * How many extra words the list says this term takes, beyond its base noun.
 *
 * `toks` are the term tokens collected in front of a sign (extract.js's
 * collectTermToks), base noun last. Returns 0 when the list says nothing about
 * this term, so the caller can fall back to its own detection.
 *
 * @param {ListTermIndex} index
 * @param {{word: string}[]} toks
 * @param {string} baseStem  Stem of the last token (the caller already has it)
 * @param {'en'|'de'} lang
 * @returns {number}
 */
export function listExtra(index, toks, baseStem, lang) {
  if (!index || !index.size || toks.length < 2) return 0;
  const byPrev = index.byBase.get(baseStem);
  if (!byPrev) return 0;
  const recs = byPrev.get(stem(toks[toks.length - 2].word, lang));
  if (!recs) return 0;
  for (const rec of recs) {
    const n = rec.stems.length;
    if (n > toks.length) continue;
    // The last two words matched by construction (they are the index keys), so
    // only anything further left needs comparing.
    let ok = true;
    for (let k = n - 3; k >= 0; k--) {
      if (stem(toks[toks.length - n + k].word, lang) !== rec.stems[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return n - 1;
  }
  return 0;
}

/**
 * Which listed multi-word terms the text actually uses as multi-word terms —
 * i.e. where the extension took effect. A term the drafter has since reduced by
 * hand drops out of this list, which is what makes the panel's count honest.
 *
 * @param {ListTermIndex} index
 * @param {Object<string, unknown>} termData  From the extraction result
 * @returns {string[]} Raw phrases, in list order
 */
export function appliedListTerms(index, termData) {
  if (!index || !index.size || !termData) return [];
  const out = [];
  for (const rec of index.all) if (termData[rec.key]) out.push(rec.term);
  return out;
}
