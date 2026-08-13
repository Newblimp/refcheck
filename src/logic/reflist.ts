import { compareSigns } from './constants.ts';
import type { SignEntry, TermEntry } from './extract.ts';

/** One row of the derived reference-numeral list. */
export interface RefListRow {
  sign: string;
  term: string;
  count: number;
}

// ── REFERENCE NUMERAL LIST ───────────────────────────────────────────────────
// Turns the extraction result into a sorted sign → term table suitable for a
// patent "List of Reference Signs". Pure (no DOM) so it can be unit-tested and
// reused by the RefList component for copy-to-clipboard.

// Pick the dominant term for a sign: the term stem with the highest occurrence
// count, tie-broken by word count (the more qualified phrasing — "erster
// planetenradsatz" over a bare "planetenradsatz" written just as often for the
// same sign) and then by earliest appearance, resolved to a human-readable raw
// term (matching how SignCard displays the first raw term).
function dominantTerm(sData: SignEntry, termData: Record<string, TermEntry>): string {
  const stems = Object.keys(sData.terms);
  if (stems.length === 0) return '';
  const firstPos: Record<string, number> = {};
  for (const p of sData.positions) {
    const seen = firstPos[p.termStem];
    if (seen === undefined || p.termStart < seen) firstPos[p.termStem] = p.termStart;
  }
  const best = stems.sort(
    (a, b) =>
      (sData.terms[b] ?? 0) - (sData.terms[a] ?? 0) ||
      b.split(' ').length - a.split(' ').length ||
      (firstPos[a] ?? Infinity) - (firstPos[b] ?? Infinity)
  )[0];
  if (best === undefined) return '';
  return [...(termData[best]?.rawTerms ?? [])][0] || best;
}

/** Rows sorted numerically by sign. */
export function buildRefList(
  signData: Record<string, SignEntry>,
  termData: Record<string, TermEntry>
): RefListRow[] {
  const rows: RefListRow[] = [];
  for (const [sign, sData] of Object.entries(signData)) {
    rows.push({ sign, term: dominantTerm(sData, termData), count: sData.count });
  }
  return rows.sort((a, b) => compareSigns(a.sign, b.sign));
}

/** Tab-separated "sign<TAB>term" lines for clipboard / pasting into a draft. */
export function toPlainText(rows: RefListRow[]): string {
  return rows.map((r) => `${r.sign}\t${r.term}`).join('\n');
}
