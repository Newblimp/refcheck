import { isSignToken, compareSigns } from './constants.js';

// ── REFERENCE-LIST PARSING ───────────────────────────────────────────────────
// Reads a drafter's "List of Reference Signs" / "Bezugszeichenliste" into
// { sign, term } rows so it can be reconciled against the signs actually used in
// the text. That list is the artefact most prone to drifting out of step with a
// draft, and checking it by hand is exactly the tedium this tool exists to
// remove.
//
// Real lists are written every which way, so the parser is deliberately liberal
// about the separator between sign and term:
//
//   10 housing            12  -  cover           14:  shaft
//   10\thousing           12 – Gehäuse           16 . seal
//   10) housing           12. cover
//
// It is strict about one thing only: the line must START with a reference sign
// (as isSignToken defines one), so prose lines and section headings inside the
// list are skipped rather than guessed at.

// Separator between the sign and its term: optional closing punctuation on the
// sign (10) / 10. / 10:) then whitespace and/or a dash.
const SEP_RE = /^[).:]?[\s\t]*[-–—:.]?[\s\t]*/;
// A trailing sign in parentheses, e.g. "housing (10)" in inverted lists.
const LEADING_SIGN_RE = /^(\S+?)(?=[).:\s\t]|$)/;

/**
 * @typedef {Object} RefListEntry
 * @property {string} sign
 * @property {string} term   Raw term as written, trimmed
 * @property {number} line   0-based source line, for reporting
 */

/**
 * Parse reference-list text into entries.
 * @param {string} text
 * @returns {{entries: RefListEntry[], duplicates: {sign: string, terms: string[]}[]}}
 */
export function parseRefList(text) {
  const entries = [];
  const lines = String(text || '').split('\n');
  lines.forEach((raw, line) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const m = LEADING_SIGN_RE.exec(trimmed);
    if (!m) return;
    const sign = m[1];
    if (!isSignToken(sign)) return; // not a list row — prose, a heading, a note
    const rest = trimmed.slice(sign.length).replace(SEP_RE, '').trim();
    if (!rest) return; // a bare sign with no term tells us nothing
    entries.push({ sign, term: rest, line });
  });

  // The same sign listed twice with different terms is itself a defect worth
  // reporting, so it is surfaced rather than silently deduplicated.
  const bySign = new Map();
  for (const e of entries) {
    const list = bySign.get(e.sign);
    if (list) list.push(e.term);
    else bySign.set(e.sign, [e.term]);
  }
  const duplicates = [];
  for (const [sign, terms] of bySign) {
    const distinct = [...new Set(terms.map((t) => t.toLowerCase()))];
    if (distinct.length > 1) duplicates.push({ sign, terms: [...new Set(terms)] });
  }
  duplicates.sort((a, b) => compareSigns(a.sign, b.sign));

  return { entries, duplicates };
}
