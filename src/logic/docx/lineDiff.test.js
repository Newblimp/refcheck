import { describe, it, expect } from 'vitest';
import { alignLines } from './lineDiff.ts';

describe('alignLines', () => {
  it('maps identical arrays one to one', () => {
    const { map, tail } = alignLines(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(map).toEqual([0, 1, 2]);
    expect(tail).toEqual([]);
  });
  it('maps a changed line in place', () => {
    const { map } = alignLines(['a', 'b', 'c'], ['a', 'B!', 'c']);
    expect(map).toEqual([0, 1, 2]);
  });
  it('marks a deleted line as null', () => {
    const { map } = alignLines(['a', 'b', 'c'], ['a', 'c']);
    expect(map[1]).toBeNull();
    expect(map[2]).toBe(1);
  });
  it('reports appended lines as tail', () => {
    const { map, tail } = alignLines(['a', 'b'], ['a', 'b', 'c']);
    expect(map).toEqual([0, 1]);
    expect(tail).toEqual(['c']);
  });
  it('attaches an inserted middle line to the preceding line', () => {
    const { insertAfter } = alignLines(['a', 'b'], ['a', 'NEW', 'b']);
    expect([...insertAfter.values()].flat()).toContain('NEW');
  });
});

describe('alignLines size bail-out', () => {
  // Past MAX_LCS_CELLS the diff falls back to positional pairing rather than
  // allocating a multi-megabyte table. That degraded path had never run.
  // NB the edits must be scattered. alignLines trims the common head and tail
  // before measuring, so a single changed line leaves a 1x1 middle and takes the
  // ordinary LCS path however long the documents are.
  const scattered = (n) => {
    const a = Array.from({ length: n }, (_, i) => `line ${i}`);
    return [a, a.map((l, i) => (i % 500 === 0 ? l + ' edited' : l))];
  };

  it('still maps every line when the LCS table would be too large', () => {
    const [a, b] = scattered(2100);
    const { map } = alignLines(a, b);
    expect(map).toHaveLength(a.length);
    // Positional pairing: index i maps to index i.
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1);
    expect(map[a.length - 1]).toBe(a.length - 1);
  });

  it('takes the ordinary LCS path when the trimmed middle is small', () => {
    // Same document length, one edit — the trim keeps this off the degraded path.
    const a = Array.from({ length: 2100 }, (_, i) => `line ${i}`);
    const b = a.map((l, i) => (i === 5 ? 'line 5 edited' : l));
    const { map } = alignLines(a, b);
    expect(map[0]).toBe(0);
    expect(map[a.length - 1]).toBe(a.length - 1);
  });

  it('stays fast on the degraded path', () => {
    const [a, b] = scattered(2100);
    const t0 = performance.now();
    alignLines(a, b);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
