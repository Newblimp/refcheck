import { describe, it, expect } from 'vitest';
import { extractData } from './extract.js';
import { computeClaimGraph } from './claims.js';
import { claimStats, THRESHOLDS } from './claimStats.js';

// Build the graph the way extractData does, from a claims buffer.
const statsFor = (text) => {
  const res = extractData(text, 'en', {}, true, true);
  const claimNums = [];
  // extractData does not expose claimNums, so re-derive them the same way the
  // app does: segment on the line-leading numbers the numbering check found.
  const lines = text.split('\n');
  let pos = 0;
  for (const line of lines) {
    const m = /^\s*(\d{1,4})[.)]/.exec(line);
    if (m) {
      const start = pos + line.indexOf(m[1]);
      claimNums.push({ value: parseInt(m[1], 10), start, end: start + m[1].length });
    }
    pos += line.length + 1;
  }
  void res;
  return claimStats(computeClaimGraph(text, claimNums));
};

const claimSet = (...lines) => lines.join('\n');

describe('claimStats', () => {
  it('returns null with no claims', () => {
    expect(claimStats(null)).toBe(null);
    expect(statsFor('Just some prose with no claims.')).toBe(null);
  });

  it('counts independent and dependent claims', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device according to claim 1, wherein the housing is metal.',
        '3. A method of making the device of claim 1.'
      )
    );
    expect(s.total).toBe(3);
    // Claim 3 references claim 1, so it counts as dependent by the graph.
    expect(s.independent).toBe(1);
    expect(s.independentNums).toEqual([1]);
    expect(s.dependent).toBe(2);
  });

  it('treats a second claim with no back-reference as independent', () => {
    const s = statsFor(
      claimSet('1. A device comprising a housing.', '2. A method of assembling a housing.')
    );
    expect(s.independent).toBe(2);
    expect(s.independentNums).toEqual([1, 2]);
  });

  it('flags a multiply-dependent claim', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device according to claim 1, wherein it is metal.',
        '3. The device according to claim 1 or 2, further comprising a cover.'
      )
    );
    expect(s.multipleDependent).toEqual([3]);
    expect(s.flags).toContain('multipleDependent');
  });

  it('treats a range as one multiply-dependent claim, not several', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device of claim 1, wherein it is metal.',
        '3. The device of claim 1, wherein it is round.',
        '4. The device according to any one of claims 1 to 3, further comprising a cover.'
      )
    );
    expect(s.multipleDependent).toEqual([4]);
  });

  it('flags a claim that depends on a multiply-dependent claim', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device of claim 1, wherein it is metal.',
        '3. The device according to claim 1 or 2, further comprising a cover.',
        '4. The device according to claim 3, wherein the cover is glass.'
      )
    );
    expect(s.multipleDependent).toEqual([3]);
    expect(s.dependsOnMultiple).toEqual([4]);
  });

  it('does not double-count a multiply-dependent claim as depending on one', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device of claim 1, wherein it is metal.',
        '3. The device according to claim 1 or 2, further comprising a cover.'
      )
    );
    expect(s.dependsOnMultiple).toEqual([]);
  });

  it('measures the longest dependency chain', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device of claim 1, wherein it is metal.',
        '3. The device of claim 2, wherein it is round.',
        '4. The device of claim 3, wherein it is red.'
      )
    );
    expect(s.maxDepth).toBe(3); // claim 4 has ancestors 1, 2, 3
  });

  it('flags the EPO excess-claims threshold', () => {
    const lines = ['1. A device comprising a housing.'];
    for (let n = 2; n <= THRESHOLDS.epoExcessClaims + 1; n++)
      lines.push(`${n}. The device of claim 1, wherein feature ${n} applies.`);
    const s = statsFor(claimSet(...lines));
    expect(s.total).toBe(THRESHOLDS.epoExcessClaims + 1);
    expect(s.flags).toContain('epoExcessClaims');
  });

  it('does not flag a claim set at the threshold', () => {
    const lines = ['1. A device comprising a housing.'];
    for (let n = 2; n <= THRESHOLDS.epoExcessClaims; n++)
      lines.push(`${n}. The device of claim 1, wherein feature ${n} applies.`);
    const s = statsFor(claimSet(...lines));
    expect(s.flags).not.toContain('epoExcessClaims');
  });

  it('flags the USPTO total and independent thresholds', () => {
    const lines = [];
    for (let n = 1; n <= THRESHOLDS.usptoIndependentClaims + 1; n++)
      lines.push(`${n}. A device comprising a housing of type ${n}.`);
    let n = lines.length + 1;
    while (lines.length <= THRESHOLDS.usptoTotalClaims) {
      lines.push(`${n}. The device of claim 1, wherein feature ${n} applies.`);
      n++;
    }
    const s = statsFor(claimSet(...lines));
    expect(s.flags).toContain('usptoTotalClaims');
    expect(s.flags).toContain('usptoIndependentClaims');
  });

  it('uses the steeper EPO band past 50 claims instead of both', () => {
    const lines = ['1. A device comprising a housing.'];
    for (let n = 2; n <= THRESHOLDS.epoHighExcessClaims + 1; n++)
      lines.push(`${n}. The device of claim 1, wherein feature ${n} applies.`);
    const s = statsFor(claimSet(...lines));
    expect(s.flags).toContain('epoHighExcessClaims');
    expect(s.flags).not.toContain('epoExcessClaims');
  });

  it('reports no flags for a conventional small claim set', () => {
    const s = statsFor(
      claimSet(
        '1. A device comprising a housing.',
        '2. The device of claim 1, wherein it is metal.',
        '3. The device of claim 2, wherein it is round.'
      )
    );
    expect(s.flags).toEqual([]);
  });
});
