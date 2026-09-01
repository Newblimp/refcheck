// ── FIND IN TEXT ────────────────────────────────────────────────────────────
//
// Literal, case-insensitive search over a buffer — what Ctrl+F drives.
//
// This is a different question from the sidebar's filter box, which narrows the
// list of findings by sign or term. That one answers "which cards do I care
// about"; this one answers "where does this word appear in my draft", which is
// what a drafter reaches for Ctrl+F expecting.

/** A match's character span in the buffer. */
export type Match = [start: number, end: number];

/**
 * How many matches are highlighted at once.
 *
 * A one-character query against a 150 KB description matches tens of thousands
 * of times, and every match becomes a `<mark>` in the backdrop. The cap is what
 * keeps a keystroke from building a document's worth of DOM; the counter says
 * `+` when it is reached, so a truncated result never poses as a complete one.
 */
export const MAX_MATCHES = 5000;

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Every occurrence of `query` in `text`, in document order and non-overlapping.
 *
 * A regex with the `i` flag rather than `indexOf` over two lowercased copies,
 * and that is not a style preference: `toLowerCase` is not length-preserving
 * (U+0130 "İ" lowercases to two code units), so offsets taken from a lowercased
 * copy can be wrong for the original string — silently, and only for text the
 * author of the search box never typed. Matching the original directly cannot
 * drift.
 *
 * The query is treated as literal text: a drafter searching for "(10)" means
 * those four characters, not a group around a number.
 */
export function findText(text: string, query: string, limit = MAX_MATCHES): Match[] {
  if (!text || !query) return [];
  const re = new RegExp(query.replace(ESCAPE_RE, '\\$&'), 'gi');
  const out: Match[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push([m.index, m.index + m[0].length]);
    if (out.length >= limit) break;
    // A query that can match empty (it cannot, since `query` is escaped and
    // non-empty) would spin here; advancing lastIndex is the cheap guarantee.
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

/**
 * Which match a search should land on first, given where the caret was.
 *
 * Searching starts from where the drafter is reading, not from the top of the
 * document — the first match at or after the anchor, wrapping to the first match
 * overall when the anchor is past all of them.
 */
export function matchFrom(matches: Match[], anchor: number): number {
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m && m[0] >= anchor) return i;
  }
  return 0;
}
