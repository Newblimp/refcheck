import { isNumOrd } from './constants.ts';
import type { Lang } from './constants.ts';

// ── CUMULATIVE REFERENCES ────────────────────────────────────────────────────
//
// A drafter who has introduced "eine erste Welle 10", "eine zweite Welle 20" and
// "eine dritte Welle 30" goes on to refer to them together, dropping the
// numbering that only ever served to tell them apart:
//
//     die Wellen 10, 20 und 30 sind koaxial zueinander
//
// Read literally that is three errors: sign 10 now carries two terms ("erste
// Welle" and "Welle"), the term "Welle" now carries three signs, and the
// definite article introduces a term that was never introduced. All three are
// artefacts of a correct draft, and they are the noise this module removes.
//
// The rule is narrow on purpose — it fires only where the shortened form is
// certain to mean the numbered one:
//
//   • SAME SIGN. The sign is the identity: "die Welle 10" can only be the thing
//     "erste Welle 10" is. That is what carries the whole rule, and it is why no
//     proximity, plural or list heuristic is needed on top of it.
//   • EXACTLY THE NUMBERING DROPPED. The shortened term must be the numbered one
//     minus its first word, stem for stem ("erst well" → "well"). A term that
//     lost something else, or gained something, is left alone.
//   • A NUMBERING, not any qualifier. "erste"/"first", not "obere"/"upper" —
//     see isNumOrd in constants.ts.
//   • ONE candidate. A sign written as both "erste Welle 10" and "zweite Welle
//     10" is itself the inconsistency the tool exists to report; with two
//     numbered forms there is no single term to fold into, so nothing is folded
//     and the error stays visible.
//
// Everything else about the shortened occurrence is untouched: it is still an
// occurrence of the sign, still counted, and in claims mode still required to be
// written in parentheses. It stops being a term of its own, nothing more.

/** The part of a recorded occurrence this rule looks at. */
export interface TermOccurrence {
  sign: string;
  /** Raw lowercased term as written ("erste welle"). */
  term: string;
  /** Stemmed term key ("erst well"). */
  termStem: string;
}

/**
 * Key into the canonical map: one sign paired with one term stem.
 *
 * Newline-joined rather than space-joined. A term stem contains spaces, so a
 * space separator would rely on signs never containing one — true today (see
 * SIGN_RE / ROMAN_RE), but an invariant owned by a different module. Neither
 * half can hold a newline: both are built from tokens, and a token never spans
 * a line.
 */
export const cumKey = (sign: string, termStem: string): string => `${sign}\n${termStem}`;

/**
 * Which shortened terms are back-references, and to what.
 *
 * @returns cumKey(sign, shortened stem) → the numbered stem it belongs to. A
 *   sign/term pair absent from the map is an ordinary occurrence.
 */
export function canonicalCumulativeTerms(
  occs: readonly TermOccurrence[],
  lang: Lang
): Map<string, string> {
  const out = new Map<string, string>();
  // sign → shortened stem → the numbered stems that shorten to it. Nested rather
  // than keyed on cumKey because the ambiguity check below asks "how many
  // numbered forms does THIS sign have for THIS base", which is that inner set.
  const numbered = new Map<string, Map<string, Set<string>>>();
  // Every (sign, term) pair actually written, so a fold is offered only for a
  // shortened form that exists.
  const written = new Set<string>();

  for (const o of occs) {
    written.add(cumKey(o.sign, o.termStem));
    const words = o.term.split(' ');
    const stems = o.termStem.split(' ');
    // The raw term and its stem are built word for word from the same tokens, so
    // the lengths always agree; checking it is what makes reading the numbering
    // off `words` and the base off `stems` safe rather than merely likely.
    if (words.length < 2 || words.length !== stems.length) continue;
    if (!isNumOrd(words[0] ?? '', lang)) continue;
    const base = stems.slice(1).join(' ');
    let byBase = numbered.get(o.sign);
    if (!byBase) numbered.set(o.sign, (byBase = new Map()));
    const at = byBase.get(base);
    if (at) at.add(o.termStem);
    else byBase.set(base, new Set([o.termStem]));
  }

  for (const [sign, byBase] of numbered) {
    for (const [base, cands] of byBase) {
      if (cands.size !== 1) continue; // ambiguous — leave the inconsistency visible
      const key = cumKey(sign, base);
      if (!written.has(key)) continue; // the numbering was never dropped
      const [canonical] = cands;
      if (canonical !== undefined) out.set(key, canonical);
    }
  }
  return out;
}
