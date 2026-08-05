// ── CLAIM-SET STATISTICS ─────────────────────────────────────────────────────
// Facts about a claim set that a drafter checks before filing, derived entirely
// from the graph computeClaimGraph already builds.
//
// Scope is European practice — DPMA and EPO. Why these numbers and not others:
// they are the ones that cost money.
//
//   • Multiple dependency ("according to claim 1 or 2") attracts a fee at the
//     EPO. A claim depending on a multiply-dependent claim compounds it, and is
//     easy to introduce by accident deep in a chain.
//   • Claim-count thresholds: the DPMA charges from the 11th claim; the EPO from
//     the 16th, and much more from the 51st.
//
// None of this is an error — a multiply-dependent claim is a legitimate drafting
// choice with a price attached — so the UI presents all of it as information
// rather than as something to fix.
//
// The thresholds are quoted as counts, not currency: fee amounts are revised
// regularly, the structure of the rules is not. Nothing here is legal advice; it
// is the arithmetic a drafter would otherwise do by hand.

/**
 * Claim-count thresholds these statistics are compared against.
 *
 * European practice only — EPO and DPMA. Both charge per claim above a limit,
 * so the drafter wants to know before filing, not after.
 *
 * The numbers are the counts the rules turn on, deliberately not the fee
 * amounts: the amounts are revised regularly, the structure of the rules is not.
 */
export const THRESHOLDS = {
  dpmaExcessClaims: 10, // DPMA: a per-claim fee applies from the 11th claim
  epoExcessClaims: 15, // EPO: a per-claim fee applies from the 16th claim
  epoHighExcessClaims: 50, // EPO: a steeper per-claim rate applies from the 51st
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
  // The two offices are reported independently: the same claim set can sit over
  // the DPMA limit and under the EPO one, and a drafter filing both wants both.
  // The EPO's own two bands are exclusive — the steeper rate replaces the first
  // rather than adding to it.
  const flags = [];
  if (total > THRESHOLDS.dpmaExcessClaims) flags.push('dpmaExcessClaims');
  if (total > THRESHOLDS.epoHighExcessClaims) flags.push('epoHighExcessClaims');
  else if (total > THRESHOLDS.epoExcessClaims) flags.push('epoExcessClaims');
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
