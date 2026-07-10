import { describe, it, expect } from 'vitest';
import { extractData } from './extract.js';

// Regression guard against accidentally quadratic behavior (the bare-term pass
// is the usual suspect). Expected time is ~50ms on a dev machine; the generous
// budget only exists to absorb slow CI runners.
describe('performance smoke', () => {
  it('extracts a >100KB patent-like document well under a second', () => {
    const parts = [];
    for (let i = 0; i < 700; i++) {
      const a = 10 + 2 * (i % 40), b = 12 + 2 * (i % 40);
      parts.push(
        `The fastening element ${a} is arranged on the housing portion ${b} and comprises ` +
        `a first bearing surface ${a}a. The housing portion ${b} further includes a mounting ` +
        `flange ${b}a which engages the fastening element ${a}.`
      );
    }
    const text = parts.join('\n');
    expect(text.length).toBeGreaterThan(100000);
    const t0 = performance.now();
    const res = extractData(text, 'en', {}, true, false);
    const ms = performance.now() - t0;
    expect(Object.keys(res.signData).length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });
});
