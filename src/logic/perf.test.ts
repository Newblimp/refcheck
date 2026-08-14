import { describe, it, expect } from 'vitest';
import type { ListTermIndex } from './listTerms.ts';
import type { ExtractResult } from './extract.ts';
import { extractData } from './extract.ts';
import { listTermIndex } from './listTerms.ts';

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

/** A distinct letters-only word per index, for building large vocabularies. */
function alpha(i: number): string {
  let s = '',
    n = i + 1;
  while (n > 0) {
    s = 'abcdefghijklmnopqrstuvwxyz'[(n - 1) % 26] + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * A big reference list whose entries ALL end in the same three base nouns —
 * the shape that would punish an index keyed on the base noun alone, since
 * every occurrence would then have to be compared against a third of the list.
 */
function bigRefList(n = 300) {
  const bases = ['element', 'portion', 'surface'];
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(`${10 + i} ${alpha(i)} ${bases[i % 3]}`);
  // Plus the phrases the corpus below actually writes, so the match path runs
  // rather than every lookup missing.
  rows.push('900 fastening element', '901 housing portion', '902 bearing surface');
  return rows.join('\n');
}

/**
 * Time one extraction — or, with `reps` above 1, the FASTEST of several.
 *
 * A guard like this asks "how fast can this go", and a single sample answers a
 * different question: a GC pause or the scheduler taking the core away inflates
 * it, and never deflates it. That is the whole flakiness mechanism here — the
 * ratio comparisons below sit an order of magnitude clear of quadratic growth,
 * so nothing but a one-off stall was ever going to fail them. Taking the minimum
 * discards those stalls without weakening the guard: a genuinely quadratic
 * implementation has no fast run to find.
 */
function timeExtract(
  text: string,
  isClaims: boolean,
  listIdx: ListTermIndex | null = null,
  reps = 1
) {
  let ms = Infinity;
  let res!: ExtractResult;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    res = extractData(text, 'en', {}, true, isClaims, listIdx);
    ms = Math.min(ms, performance.now() - t0);
  }
  return { ms, res };
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
    const a = timeExtract(small, false, null, 3).ms;
    const b = timeExtract(large, false, null, 3).ms;
    // Allow generous slack for timer noise on tiny durations, but 16x (true
    // quadratic growth) is far outside it.
    expect(b).toBeLessThan(Math.max(a * 10, 60));
  });

  it('applies a 300-entry reference list to a >100KB description for a few percent', () => {
    // The list is consulted once per sign occurrence. Indexing on the last two
    // words keeps that a Map hit however long the list is; keying on the base
    // noun alone would turn this corpus into 100 comparisons per occurrence.
    const text = plainDescription();
    const idx = listTermIndex(bigRefList(), 'en');
    expect(idx.size).toBeGreaterThan(300);
    timeExtract(text, false, idx); // warm
    const withList = timeExtract(text, false, idx, 3);
    const without = timeExtract(text, false, null, 3).ms;
    // The extended terms really did land, so this is not measuring a no-op.
    expect(Object.keys(withList.res.termData)).toContain('fasten elem');
    expect(withList.ms).toBeLessThan(Math.max(without * 2, 60));
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

  it('does not go cubic as a preceding-claims chain grows', () => {
    // "Any one of the preceding claims" makes every claim depend on every
    // earlier one, so the ancestor sets hold O(claims²) numbers however they are
    // built — that part is the answer's own size and cannot be helped. What CAN
    // be helped is unioning each parent's whole closure in again: that made the
    // transitive closure O(claims³), and the absolute budget above never saw it
    // because 150 claims is small enough to hide a cube.
    //
    // 4x the claims therefore costs ~8x (a quadratic answer diluted by the
    // linear scans around it) and the cubic form cost ~38x, so the limit sits
    // between them rather than at either.
    const small = bigClaimSet(100);
    const large = bigClaimSet(400);
    timeExtract(small, true); // warm the stem cache and JIT
    const a = timeExtract(small, true, null, 3).ms;
    const b = timeExtract(large, true, null, 3).ms;
    expect(b).toBeLessThan(Math.max(a * 20, 60));
  });
});
