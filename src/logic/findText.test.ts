import { describe, it, expect } from 'vitest';
import { findText, matchFrom, MAX_MATCHES } from './findText.ts';

const TEXT = 'The housing 12 holds the Housing 12.\nA HOUSING is a housing.';

describe('findText', () => {
  it('finds every occurrence, in document order, whatever the case', () => {
    const m = findText(TEXT, 'housing');
    expect(m.length).toBe(4);
    expect(m.map(([s, e]) => TEXT.slice(s, e))).toEqual([
      'housing',
      'Housing',
      'HOUSING',
      'housing',
    ]);
    expect(m.map(([s]) => s)).toEqual([...m.map(([s]) => s)].sort((a, b) => a - b));
  });

  it('returns spans that name the matched text exactly', () => {
    for (const [s, e] of findText(TEXT, 'housing'))
      expect(TEXT.slice(s, e).toLowerCase()).toBe('housing');
  });

  it('has nothing to say about an empty query or an empty buffer', () => {
    expect(findText(TEXT, '')).toEqual([]);
    expect(findText('', 'housing')).toEqual([]);
  });

  it('treats the query as literal text, not as a pattern', () => {
    // A drafter searching for "(12)" means those four characters. Read as a
    // regex this is a group around a number and would match "12" anywhere.
    const claims = 'A device (10) with a housing (12) and a cover 12.';
    expect(findText(claims, '(12)').map(([s, e]) => claims.slice(s, e))).toEqual(['(12)']);
    expect(findText('a.b and axb', 'a.b').length).toBe(1);
  });

  it('never returns overlapping spans', () => {
    const m = findText('aaaa', 'aa');
    expect(m).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it('stops at the cap rather than marking up a whole document', () => {
    // One character against a large buffer is the case the cap exists for: every
    // match becomes a <mark> in the backdrop.
    const big = 'e'.repeat(MAX_MATCHES + 500);
    expect(findText(big, 'e').length).toBe(MAX_MATCHES);
    expect(findText(big, 'e', 10).length).toBe(10);
  });

  it('matches text a lowercasing search would take the wrong offsets for', () => {
    // "İ" (U+0130) lowercases to TWO code units, so offsets read off a
    // lowercased copy would be shifted for everything after it. Matching the
    // original string directly cannot drift.
    const text = 'İstanbul housing 12';
    const [m] = findText(text, 'housing');
    expect(m && text.slice(m[0], m[1])).toBe('housing');
  });
});

describe('matchFrom', () => {
  const ms: [number, number][] = [
    [10, 12],
    [40, 42],
    [90, 92],
  ];

  it('lands on the first match at or after the caret', () => {
    expect(matchFrom(ms, 0)).toBe(0);
    expect(matchFrom(ms, 10)).toBe(0);
    expect(matchFrom(ms, 11)).toBe(1);
    expect(matchFrom(ms, 40)).toBe(1);
    expect(matchFrom(ms, 41)).toBe(2);
  });

  it('wraps to the first match when the caret is past all of them', () => {
    expect(matchFrom(ms, 500)).toBe(0);
  });

  it('has an answer for an empty match list', () => {
    expect(matchFrom([], 42)).toBe(0);
  });
});
