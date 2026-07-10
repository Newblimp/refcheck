import { describe, it, expect } from 'vitest';
import { segmentClaims, parseClaimRefs, computeClaimGraph } from './claims.js';

// Helper: claimNums as extractData produces them (line-leading numbers).
const nums = (text) => {
  const out = [];
  const re = /^[ \t]*(\d+)[.)]/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s = m.index + m[0].indexOf(m[1]);
    out.push({ value: parseInt(m[1], 10), start: s, end: s + m[1].length });
  }
  return out;
};

describe('segmentClaims', () => {
  it('splits the buffer into contiguous per-claim spans', () => {
    const text = '1. A device (10).\n2. The device (10) of claim 1.\n3. The device (10) of claim 2.';
    const claims = segmentClaims(text, nums(text));
    expect(claims.map(c => c.num)).toEqual([1, 2, 3]);
    expect(claims[0].end).toBe(claims[1].start);
    expect(claims[1].end).toBe(claims[2].start);
    expect(claims[2].end).toBe(text.length);
  });
});

describe('parseClaimRefs', () => {
  it('finds a single reference with its exact position', () => {
    const body = 'The device of claim 3, wherein it is round.';
    const { refs } = parseClaimRefs(body);
    expect(refs).toHaveLength(1);
    expect(refs[0].num).toBe(3);
    expect(body.slice(refs[0].start, refs[0].end)).toBe('3');
  });

  it('applies the offset to reported positions', () => {
    const { refs } = parseClaimRefs('see claim 7 here', 100);
    expect(refs[0].start).toBe(110);
  });

  it('parses a comma/or list', () => {
    const { refs, nums: n } = parseClaimRefs('according to claims 1, 2 or 4');
    expect(refs.map(r => r.num)).toEqual([1, 2, 4]);
    expect([...n].sort()).toEqual([1, 2, 4]);
  });

  it('expands a "to" range into intermediates (nums) but keeps refs literal', () => {
    const { refs, nums: n } = parseClaimRefs('according to any one of claims 1 to 4');
    expect(refs.map(r => r.num)).toEqual([1, 4]);
    expect([...n].sort()).toEqual([1, 2, 3, 4]);
  });

  it('parses German references and "bis" ranges', () => {
    expect(parseClaimRefs('nach Anspruch 2').refs.map(r => r.num)).toEqual([2]);
    const { nums: n } = parseClaimRefs('nach einem der Ansprüche 1 bis 3');
    expect([...n].sort()).toEqual([1, 2, 3]);
  });

  it('detects "preceding claims" phrases (EN + DE)', () => {
    expect(parseClaimRefs('according to any one of the preceding claims').allPreceding).toBe(true);
    expect(parseClaimRefs('nach einem der vorhergehenden Ansprüche').allPreceding).toBe(true);
    expect(parseClaimRefs('according to claim 1').allPreceding).toBe(false);
  });

  it('does not let a trailing comma swallow following words ("claim 1, wherein")', () => {
    const { refs } = parseClaimRefs('The device of claim 1, wherein the seal is round.');
    expect(refs.map(r => r.num)).toEqual([1]);
  });

  it('returns nothing for a claim without references', () => {
    const { refs, nums: n, allPreceding } = parseClaimRefs('A device comprising a housing.');
    expect(refs).toEqual([]);
    expect(n.size).toBe(0);
    expect(allPreceding).toBe(false);
  });
});

describe('computeClaimGraph', () => {
  it('returns null when there are no claims', () => {
    expect(computeClaimGraph('no claims here', [])).toBeNull();
  });

  it('builds transitive ancestor sets', () => {
    const text = '1. A device (10).\n2. The device of claim 1.\n3. The device of claim 2.';
    const g = computeClaimGraph(text, nums(text));
    expect([...g.ancestors.get(1)]).toEqual([]);
    expect([...g.ancestors.get(2)]).toEqual([1]);
    expect([...g.ancestors.get(3)].sort()).toEqual([1, 2]);
  });

  it('range intermediates become ancestors', () => {
    const text =
      '1. A device (10).\n2. The device of claim 1.\n3. The device of claim 1.\n' +
      '4. The device of any one of claims 1 to 3.';
    const g = computeClaimGraph(text, nums(text));
    expect([...g.ancestors.get(4)].sort()).toEqual([1, 2, 3]);
  });

  it('"preceding claims" makes every earlier claim an ancestor', () => {
    const text = '1. A device (10).\n2. The device of claim 1.\n3. The device of any preceding claims.';
    const g = computeClaimGraph(text, nums(text));
    expect([...g.ancestors.get(3)].sort()).toEqual([1, 2]);
  });

  it('classifies missing / forward / self references', () => {
    const text =
      '1. A device as in claim 3.\n' + // forward (3 exists)
      '2. The device of claim 2.\n' + // self
      '3. The device of claim 9.'; // missing
    const g = computeClaimGraph(text, nums(text));
    expect(g.depErrors.map(e => [e.claim, e.ref, e.type])).toEqual([
      [1, 3, 'forward'],
      [2, 2, 'self'],
      [3, 9, 'missing'],
    ]);
  });

  it('gives duplicate bad references distinct, stable keys', () => {
    const text = '1. A device of claim 9 or claim 9.';
    const g = computeClaimGraph(text, nums(text));
    expect(g.depErrors.map(e => e.key)).toEqual(['1>9#1', '1>9#2']);
  });

  it('bad references never create dependency edges (graph stays acyclic)', () => {
    const text = '1. A device as in claim 2.\n2. The device of claim 1.';
    const g = computeClaimGraph(text, nums(text));
    expect([...g.ancestors.get(1)]).toEqual([]); // forward ref ignored as edge
    expect([...g.ancestors.get(2)]).toEqual([1]);
  });
});
