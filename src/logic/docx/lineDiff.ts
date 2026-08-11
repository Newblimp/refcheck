// ── LINE DIFF ────────────────────────────────────────────────────────────────
// Aligns the lines a .docx imported as against the lines the user left in the
// buffer. Pure string work — it knows nothing about OOXML, paragraphs or claims,
// which is what makes it cheap to reason about and to test in isolation.
//
// The result is deliberately conservative: it says which old line became which
// new line, which old lines went away, and which new lines are brand new. What
// to DO about each of those (rewrite a paragraph, clone one, delete one) is the
// writer's job, not this module's.

// Cell budget for the LCS table. Beyond this the diff falls back to positional
// pairing: a 2000x2000 table is already 16MB and 4M iterations, which is not a
// reasonable thing to do in a browser tab for a cosmetic alignment improvement.
const MAX_LCS_CELLS = 4_000_000;

/** Longest common subsequence of two line arrays → aligned index pairs. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length,
    m = b.length;
  const pairs: [number, number][] = [];
  if (!n || !m) return pairs;
  // Bounded: past this size the prefix/suffix trim in alignLines has already
  // failed to reduce the problem, and a positional pairing is good enough.
  if (n * m > MAX_LCS_CELLS) return pairs;
  const dp = new Int32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? (dp[(i + 1) * w + (j + 1)] ?? 0) + 1
          : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + (j + 1)] ?? 0);
    }
  }
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + (j + 1)] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

/** Which imported line became which edited line. */
export interface LineAlignment {
  /** map[i] = index in `b` that old line i became, or null if it was deleted. */
  map: (number | null)[];
  /** Brand-new lines that follow old line i. */
  insertAfter: Map<number, string[]>;
  /** Brand-new lines after the very last old line. */
  tail: string[];
}

/**
 * Align old lines to new lines.
 * @param a Lines as imported
 * @param b Lines as the user left them
 */
export function alignLines(a: string[], b: string[]): LineAlignment {
  const map: (number | null)[] = new Array(a.length).fill(null);
  const insertAfter = new Map<number, string[]>();
  // Trim the common head and tail first; in practice this leaves a tiny middle.
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) {
    map[lo] = lo;
    lo++;
  }
  let hi = 0;
  while (
    hi < a.length - lo &&
    hi < b.length - lo &&
    a[a.length - 1 - hi] === b[b.length - 1 - hi]
  ) {
    map[a.length - 1 - hi] = b.length - 1 - hi;
    hi++;
  }
  const aMid = a.slice(lo, a.length - hi);
  const bMid = b.slice(lo, b.length - hi);
  if (!aMid.length && !bMid.length) return { map, insertAfter, tail: [] };

  const anchors: [number, number][] = lcsPairs(aMid, bMid).map(([i, j]) => [i + lo, j + lo]);
  // Walk anchor to anchor, pairing the lines in between positionally.
  const blocks: [number, number, number, number][] = [];
  let pi = lo,
    pj = lo;
  for (const [ai, bj] of anchors) {
    blocks.push([pi, ai, pj, bj]);
    map[ai] = bj;
    pi = ai + 1;
    pj = bj + 1;
  }
  blocks.push([pi, a.length - hi, pj, b.length - hi]);

  const tail: string[] = [];
  const isBlank = (s: string | undefined) => !s?.trim();
  // `at` is the first old line not yet consumed, so the new line belongs after
  // old line at-1. With no old line before it, or none left after it anywhere,
  // it belongs to the tail.
  const addInsert = (line: string | undefined, at: number) => {
    if (line === undefined) return;
    const anchor = at - 1;
    if (anchor < 0 || at >= a.length) tail.push(line);
    else insertAfter.set(anchor, [...(insertAfter.get(anchor) ?? []), line]);
  };

  for (const [a0, a1, b0, b1] of blocks) {
    let ai = a0,
      bj = b0;
    // Pair line for line, but never pair a blank line with a real one. A spacer
    // paragraph between claims carries none of a claim's numbering or
    // indentation, so writing claim text into it strands that claim at a
    // different alignment from the rest — and deletes the paragraph that had
    // the right formatting.
    while (ai < a1 && bj < b1) {
      if (isBlank(a[ai]) === isBlank(b[bj])) {
        map[ai] = bj;
        ai++;
        bj++;
      } else if (isBlank(a[ai])) {
        ai++; // the edit removed a spacer
      } else {
        addInsert(b[bj++], ai); // the edit added a spacer
      }
    }
    // Surplus new lines are insertions; surplus old lines stay null (deleted).
    while (bj < b1) addInsert(b[bj++], ai);
  }
  return { map, insertAfter, tail };
}
