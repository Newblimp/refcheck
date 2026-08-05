import { describe, it, expect } from 'vitest';
import { extractData } from './extract.js';

// Regression guards against accidentally quadratic behaviour. Each corpus below
// targets a specific hot path; the budgets are generous enough to absorb a slow
// CI runner but tight enough that a return to O(n²) blows straight through them.
//
// Note the shapes matter as much as the sizes. The original single corpus here
// contained no sign ranges/lists and never ran in claims mode, so two of the
// three quadratic paths in extractData were invisible to it — a list-heavy
// document of *two thirds* the size took four times as long, and this guard
// stayed green throughout.

/** Plain description prose: sign-per-term, no lists. Exercises the bare-term pass. */
function plainDescription(n = 700) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = 10 + 2 * (i % 40),
      b = 12 + 2 * (i % 40);
    parts.push(
      `The fastening element ${a} is arranged on the housing portion ${b} and comprises ` +
        `a first bearing surface ${a}a. The housing portion ${b} further includes a mounting ` +
        `flange ${b}a which engages the fastening element ${a}.`
    );
  }
  return parts.join('\n');
}

/** Description dense with ranges and lists — exercises the LIST_RE scan. */
function listHeavyDescription(n = 700) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = 10 + 2 * (i % 40),
      b = 12 + 2 * (i % 40);
    parts.push(
      `The fastening elements ${a}, ${a + 100} and ${a + 200} are arranged on the housing ` +
        `portions ${b} to ${b + 6}, and the bearing surfaces ${a}a, ${b}a; ${b}b engage ` +
        `the flange ${b}.`
    );
  }
  return parts.join('\n');
}

/** A long claim set where every claim depends on all the preceding ones. */
function bigClaimSet(n = 150) {
  const c = ['1. A device (10) comprising a housing (12), a cover (14) and a shaft (16).'];
  for (let i = 2; i <= n; i++) {
    c.push(
      `${i}. The device (10) according to any one of the preceding claims, wherein the ` +
        `housing (12) comprises a bearing surface (${18 + i}) and the cover (14) is secured ` +
        `to the housing (12) by fastening elements (${100 + i}, ${200 + i}).`
    );
  }
  return c.join('\n');
}

function timeExtract(text, isClaims) {
  const t0 = performance.now();
  const res = extractData(text, 'en', {}, true, isClaims);
  return { ms: performance.now() - t0, res };
}

describe('performance smoke', () => {
  it('extracts a >100KB plain description well under a second', () => {
    const text = plainDescription();
    expect(text.length).toBeGreaterThan(100000);
    const { ms, res } = timeExtract(text, false);
    expect(Object.keys(res.signData).length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });

  it('extracts a >100KB range/list-heavy description without going quadratic', () => {
    // The list scan locates the term preceding each match. Doing that with a
    // findIndex from position 0 made this corpus ~4x slower than the plain one
    // above despite being smaller; with a monotonic cursor the two are level.
    const text = listHeavyDescription();
    expect(text.length).toBeGreaterThan(100000);
    const { ms, res } = timeExtract(text, false);
    expect(Object.keys(res.signData).length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });

  it('stays roughly linear as the number of list constructs grows', () => {
    // A direct shape check: 4x the text should cost far less than the 16x a
    // quadratic list scan would produce. Ratios rather than absolute times, so
    // this holds on a slow runner too.
    const small = listHeavyDescription(200);
    const large = listHeavyDescription(800);
    timeExtract(small, false); // warm the stem cache and JIT
    const a = timeExtract(small, false).ms;
    const b = timeExtract(large, false).ms;
    // Allow generous slack for timer noise on tiny durations, but 16x (true
    // quadratic growth) is far outside it.
    expect(b).toBeLessThan(Math.max(a * 10, 60));
  });

  it('handles a 150-claim set with full preceding-claim dependencies', () => {
    // Claims mode adds the claim graph, per-claim antecedent basis and the
    // numbering scan — none of which the original perf corpus ever ran.
    const text = bigClaimSet();
    const { ms, res } = timeExtract(text, true);
    expect(res.depErrors.length).toBe(0);
    expect(Object.keys(res.signData).length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});
