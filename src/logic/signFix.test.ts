import { describe, it, expect } from 'vitest';
import { suggestSign } from './signFix.ts';
import { extractData } from './extract.ts';
import type { TermEntry } from './extract.ts';

// The "which sign did the drafter mean" decision, on its own. The refusals
// matter as much as the proposals: this offer rewrites the drafter's text, so
// it must appear only where the evidence is one-sided.

const termData = (signs: Record<string, Record<string, number>>): Record<string, TermEntry> =>
  Object.fromEntries(
    Object.entries(signs).map(([ts, s]) => [ts, { signs: s, rawTerms: new Set([ts]) }])
  );

describe('suggestSign', () => {
  it('proposes the sign the term is written with more often', () => {
    // "Begriff 1 / Begriff 2 / Begriff 1" — the 2 is the odd one out.
    const td = termData({ begriff: { '1': 2, '2': 1 } });
    expect(suggestSign('begriff', '2', td)).toEqual({ sign: '1', count: 2 });
  });

  it('proposes nothing for an occurrence that already carries the usual sign', () => {
    const td = termData({ begriff: { '1': 2, '2': 1 } });
    expect(suggestSign('begriff', '1', td)).toBe(null);
  });

  it('refuses an even split — there is no majority to read', () => {
    const td = termData({ begriff: { '1': 1, '2': 1 } });
    expect(suggestSign('begriff', '1', td)).toBe(null);
    expect(suggestSign('begriff', '2', td)).toBe(null);
  });

  it('refuses a tie between two alternatives', () => {
    const td = termData({ begriff: { '1': 2, '2': 2, '3': 1 } });
    expect(suggestSign('begriff', '3', td)).toBe(null);
  });

  it('proposes nothing when the term has only one sign', () => {
    expect(suggestSign('begriff', '1', termData({ begriff: { '1': 3 } }))).toBe(null);
  });

  it('proposes nothing for an unknown term', () => {
    expect(suggestSign('nowhere', '1', termData({ begriff: { '1': 3 } }))).toBe(null);
  });

  it('counts the majority across three signs', () => {
    const td = termData({ begriff: { '1': 5, '2': 1, '3': 1 } });
    expect(suggestSign('begriff', '2', td)).toEqual({ sign: '1', count: 5 });
  });

  it('reads a real extraction, not just hand-built data', () => {
    const res = extractData('Begriff 1\nBegriff 2\nBegriff 1', 'de');
    const p = res.signData['2'].positions[0];
    expect(suggestSign(p.termStem, '2', res.termData)).toEqual({ sign: '1', count: 2 });
    const p1 = res.signData['1'].positions[0];
    expect(suggestSign(p1.termStem, '1', res.termData)).toBe(null);
  });
});
