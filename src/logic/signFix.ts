import type { TermEntry } from './extract.ts';

// ── THE SIGN THIS TERM IS USUALLY WRITTEN WITH ───────────────────────────────
//
// A mistyped reference sign reads exactly like a term-to-sign inconsistency,
// because that is what it is:
//
//     Begriff 1
//     Begriff 2      ← the typo
//     Begriff 1
//
// The tool already reports the sign as inconsistent. What it could not do was
// say which of the two is the slip, so the drafter had to work it out and
// retype it. Frequency answers that: the term is written with 1 twice and with
// 2 once, so 2 is the odd one out and the editor's context menu offers to
// change it.
//
// Two refusals keep this an offer rather than a guess:
//
//   • The occurrence's own sign must be strictly LESS common for this term than
//     the proposal. An even split ("Begriff 1 / Begriff 2") is no evidence at
//     all — that is a genuine ambiguity for the drafter to resolve, and
//     proposing either side would be inventing a majority.
//   • A tie between two alternatives is refused for the same reason, matching
//     how the bare-term menu withholds "insert sign" when the term has two.
//
// It deliberately looks at ONE term's signs and nothing else. A sign carrying
// several terms is a different question (which one is the sign's real term),
// and the reference list already answers that one.

/** What to propose in place of the sign at the caret. */
export interface SignSuggestion {
  /** The sign to write instead. */
  sign: string;
  /** How often this term is written with it — the evidence, shown in the menu. */
  count: number;
}

/**
 * @param termStem The term of the occurrence at the caret
 * @param sign     The sign it was written with there
 * @returns null when there is no clear majority to propose
 */
export function suggestSign(
  termStem: string,
  sign: string,
  termData: Record<string, TermEntry>
): SignSuggestion | null {
  const signs = termData[termStem]?.signs;
  if (!signs) return null;
  const here = signs[sign] ?? 0;
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [s, n] of Object.entries(signs)) {
    if (s === sign) continue;
    if (n > bestN) {
      best = s;
      bestN = n;
      tied = false;
    } else if (n === bestN) tied = true;
  }
  if (best === null || tied || bestN <= here) return null;
  return { sign: best, count: bestN };
}
