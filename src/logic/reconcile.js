import { compareSigns } from './constants.js';
import { stem } from './stem.js';
import { buildRefList } from './reflist.js';
import { parseRefList } from './refListParse.js';

// ── REFERENCE-LIST RECONCILIATION ────────────────────────────────────────────
// Compares the drafter's own reference-sign list against the signs actually used
// in the text, and reports the three ways they drift apart:
//
//   • listedNotUsed  — in the list, never used in the text (usually a leftover
//                      from a deleted embodiment)
//   • usedNotListed  — used in the text, missing from the list (the list was not
//                      updated when the passage was added)
//   • termMismatch   — same sign, different term in each (the risky one: the
//                      list says "housing", the text says "casing")
//
// Structurally the same problem computeCrossRef solves for Description vs
// Claims, and it is modelled on that function deliberately — same shape of
// output, so the sidebar renders it the same way.

/**
 * @typedef {Object} ReconcileResult
 * @property {{sign: string, term: string}[]} listedNotUsed
 * @property {{sign: string, term: string, count: number}[]} usedNotListed
 * @property {{sign: string, listTerm: string, textTerm: string}[]} termMismatch
 * @property {{sign: string, terms: string[]}[]} duplicates  Same sign twice in the list
 * @property {number} listed  Total entries parsed, for the "n of m match" summary
 * @property {number} matched
 */

/**
 * @param {string} listText  Raw reference-list text (pasted or imported)
 * @param {import('./extract.js').ExtractResult} result  Extraction of the text to check
 * @param {'en'|'de'} lang
 * @returns {ReconcileResult|null} null when there is nothing to compare
 */
export function reconcileRefList(listText, result, lang) {
  if (!listText || !listText.trim() || !result) return null;
  const { entries, duplicates } = parseRefList(listText);
  if (!entries.length) return null;

  // Dominant term per sign as actually used, reusing the same derivation the
  // Reference list panel and its clipboard export already use.
  const used = buildRefList(result.signData, result.termData);
  const usedBySign = new Map(used.map((r) => [r.sign, r]));

  // First listing wins for a sign listed twice; the duplication is reported
  // separately rather than being allowed to skew the comparison.
  const listBySign = new Map();
  for (const e of entries) if (!listBySign.has(e.sign)) listBySign.set(e.sign, e);

  const listedNotUsed = [];
  const termMismatch = [];
  let matched = 0;
  for (const [sign, entry] of listBySign) {
    const row = usedBySign.get(sign);
    if (!row) {
      listedNotUsed.push({ sign, term: entry.term });
      continue;
    }
    // Compare on stems, so "bearings" in the list and "bearing" in the text are
    // the same term rather than a false alarm. Multi-word terms compare
    // word-by-word, which is how termStem is built in the first place.
    if (stemPhrase(entry.term, lang) === stemPhrase(row.term, lang)) matched++;
    else termMismatch.push({ sign, listTerm: entry.term, textTerm: row.term });
  }

  const usedNotListed = used
    .filter((r) => !listBySign.has(r.sign))
    .map((r) => ({ sign: r.sign, term: r.term, count: r.count }));

  listedNotUsed.sort((a, b) => compareSigns(a.sign, b.sign));
  termMismatch.sort((a, b) => compareSigns(a.sign, b.sign));

  const hasAny =
    listedNotUsed.length || usedNotListed.length || termMismatch.length || duplicates.length;
  return {
    listedNotUsed,
    usedNotListed,
    termMismatch,
    duplicates,
    listed: listBySign.size,
    matched,
    hasAny: !!hasAny,
  };
}

/** Stem every word of a term so list and text spellings compare fairly. */
function stemPhrase(phrase, lang) {
  return String(phrase)
    .toLowerCase()
    .split(/[\s ]+/)
    .filter(Boolean)
    .map((w) => stem(w, lang))
    .join(' ');
}
