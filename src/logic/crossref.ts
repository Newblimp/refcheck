import { compareSigns } from './constants.ts';
import type { ExtractResult } from './extract.ts';

/** The same sign carrying different terms in the two buffers. */
export interface SignConflict {
  sign: string;
  descTerms: string[];
  claimsTerms: string[];
}

/** The same term carrying different signs in the two buffers. */
export interface TermConflict {
  /** The term stem the two buffers agree on. */
  ts: string;
  /** A human-readable spelling of it. */
  rawTerm: string;
  descSigns: string[];
  claimsSigns: string[];
}

export interface CrossRef {
  /** In the claims, never seen in the description at all. */
  missingInDesc: string[];
  /** In the description, never seen in the claims. */
  missingInClaims: string[];
  signConflicts: SignConflict[];
  termConflicts: TermConflict[];
  /** In the description, but only ever bare — never properly introduced. */
  notIntroducedInDesc: string[];
}

// ── CROSS-REFERENCE ─────────────────────────────────────────────────────────
// Compares the extraction results of the Description and Claims buffers and
// reports signs/terms that are present in one but missing or conflicting in the
// other. Returns null when there is nothing to report.
export function computeCrossRef(
  descResult: ExtractResult | null | undefined,
  claimsResult: ExtractResult | null | undefined
): CrossRef | null {
  if (!descResult || !claimsResult) return null;
  const dS = new Set(Object.keys(descResult.signData));
  const cS = new Set(Object.keys(claimsResult.signData));
  const descNoTerm = descResult.noTermSigns ?? new Set<string>();

  // A claims sign absent from the description's termful signs is either
  // missing entirely or seen there only bare (never introduced with a term).
  const missingInDesc: string[] = [];
  const notIntroducedInDesc: string[] = [];
  const signConflicts: SignConflict[] = [];
  const raws = (r: ExtractResult, stems: string[]) => [
    ...new Set(stems.flatMap((ts) => [...(r.termData[ts]?.rawTerms ?? [])])),
  ];
  for (const sign of cS) {
    if (!dS.has(sign)) {
      (descNoTerm.has(sign) ? notIntroducedInDesc : missingInDesc).push(sign);
      continue;
    }
    // Same sign, different term across buffers
    const dT = Object.keys(descResult.signData[sign]?.terms ?? {});
    const cT = Object.keys(claimsResult.signData[sign]?.terms ?? {});
    if (!dT.some((t) => cT.includes(t)))
      signConflicts.push({
        sign,
        descTerms: raws(descResult, dT),
        claimsTerms: raws(claimsResult, cT),
      });
  }
  missingInDesc.sort(compareSigns);
  notIntroducedInDesc.sort(compareSigns);
  signConflicts.sort((a, b) => compareSigns(a.sign, b.sign));
  const missingInClaims = [...dS].filter((s) => !cS.has(s)).sort(compareSigns);

  // Same term, different sign across buffers
  const termConflicts: TermConflict[] = [];
  const dTD = new Set(Object.keys(descResult.termData));
  const cTD = new Set(Object.keys(claimsResult.termData));
  for (const ts of [...dTD].filter((t) => cTD.has(t))) {
    const dSigns = Object.keys(descResult.termData[ts]?.signs ?? {});
    const cSigns = Object.keys(claimsResult.termData[ts]?.signs ?? {});
    if (!dSigns.some((s) => cSigns.includes(s))) {
      const rawTerm = [...(descResult.termData[ts]?.rawTerms ?? [])][0] || ts;
      termConflicts.push({
        ts,
        rawTerm,
        descSigns: dSigns.sort(compareSigns),
        claimsSigns: cSigns.sort(compareSigns),
      });
    }
  }

  const hasAny =
    missingInDesc.length ||
    missingInClaims.length ||
    signConflicts.length ||
    termConflicts.length ||
    notIntroducedInDesc.length;
  return hasAny
    ? { missingInDesc, missingInClaims, signConflicts, termConflicts, notIntroducedInDesc }
    : null;
}
