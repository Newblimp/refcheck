// ── CLAIM-SET STATISTICS ─────────────────────────────────────────────────────
// Facts about a claim set that a drafter checks before filing, derived entirely
// from the graph computeClaimGraph already builds.
//
// Why these numbers and not others — they are the ones that cost money or
// invite an objection:
//
//   • Multiple dependency ("according to claim 1 or 2") attracts a fee at the
//     EPO and is not allowed at all in US practice, so a claim set drafted for
//     both needs them flagged. A claim depending on a multiply-dependent claim
//     is worse still, and easy to introduce by accident deep in a chain.
//   • Claim-count thresholds: the EPO charges from the 16th claim and much more
//     from the 51st; the USPTO charges past 20 total or 3 independent.
//
// The thresholds are quoted as counts, not currency — fee amounts change, the
// structure of the rules does not. Nothing here is legal advice; it is the
// arithmetic a drafter would otherwise do by hand.

/** Claim-count thresholds these statistics are compared against. */
export const THRESHOLDS = {
  epoExcessClaims: 15, // fees apply from claim 16
  epoHighExcessClaims: 50, // a steeper rate applies from claim 51
  usptoTotalClaims: 20, // excess-claim fees past 20
  usptoIndependentClaims: 3, // excess-independent fees past 3
};

/**
 * @typedef {Object} ClaimStats
 * @property {number} total
 * @property {number} independent
 * @property {number} dependent
 * @property {number[]} independentNums
 * @property {number[]} multipleDependent      Claims with more than one direct parent
 * @property {number[]} dependsOnMultiple      Claims whose chain passes through one
 * @property {number} maxDepth                 Longest dependency chain
 * @property {string[]} flags                  Threshold keys that were exceeded
 */

/**
 * @param {ReturnType<import('./claims.js').computeClaimGraph>} graph
 * @returns {ClaimStats|null} null when the buffer holds no claims
 */
export function claimStats(graph) {
  if (!graph || !graph.claims.length) return null;
  const { claims, direct, ancestors } = graph;

  const independentNums = [];
  const multipleDependent = [];
  for (const c of claims) {
    const parents = direct.get(c.num);
    const n = parents ? parents.size : 0;
    if (n === 0) independentNums.push(c.num);
    // "Multiply dependent" means more than one *direct* alternative parent —
    // "any one of claims 1 to 4" is one such claim, not four separate ones.
    else if (n > 1) multipleDependent.push(c.num);
  }

  const multiSet = new Set(multipleDependent);
  const dependsOnMultiple = [];
  for (const c of claims) {
    if (multiSet.has(c.num)) continue;
    const anc = ancestors.get(c.num);
    if (anc && [...anc].some((a) => multiSet.has(a))) dependsOnMultiple.push(c.num);
  }

  // Depth via the transitive closure, which is already computed and acyclic.
  let maxDepth = 0;
  for (const c of claims) {
    const anc = ancestors.get(c.num);
    const d = anc ? anc.size : 0;
    if (d > maxDepth) maxDepth = d;
  }

  const total = claims.length;
  const flags = [];
  if (total > THRESHOLDS.epoHighExcessClaims) flags.push('epoHighExcessClaims');
  else if (total > THRESHOLDS.epoExcessClaims) flags.push('epoExcessClaims');
  if (total > THRESHOLDS.usptoTotalClaims) flags.push('usptoTotalClaims');
  if (independentNums.length > THRESHOLDS.usptoIndependentClaims)
    flags.push('usptoIndependentClaims');
  if (multipleDependent.length) flags.push('multipleDependent');

  return {
    total,
    independent: independentNums.length,
    dependent: total - independentNums.length,
    independentNums,
    multipleDependent,
    dependsOnMultiple,
    maxDepth,
    flags,
  };
}
