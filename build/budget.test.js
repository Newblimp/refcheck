import { describe, it, expect } from 'vitest';
import { checkBudget, BUDGETS } from './budget.js';

const K = 1024;
const files = [
  { name: 'index.html', gzip: 6 * K },
  { name: 'assets/index-abc.js', gzip: 30 * K },
  { name: 'assets/vendor-def.js', gzip: 8 * K },
  // Fetched on demand, so outside the critical path but inside the shell.
  { name: 'assets/importDoc-ghi.js', gzip: 13 * K },
  { name: 'assets/Bee-jkl.js', gzip: 1 * K },
  { name: 'assets/HelpDialog-pqr.js', gzip: 2 * K },
  { name: 'assets/bee-mno.svg', gzip: 2 * K },
];

describe('checkBudget', () => {
  it('counts only the render-path files toward the critical budget', () => {
    const { critical } = checkBudget(files, BUDGETS);
    expect(critical).toBe(44 * K);
  });

  it('counts everything toward the shell budget', () => {
    const { total } = checkBudget(files, BUDGETS);
    expect(total).toBe(62 * K);
  });

  it('passes a bundle inside both budgets', () => {
    expect(checkBudget(files, { critical: 50 * K, total: 70 * K }).failures).toEqual([]);
  });

  it('fails on a critical path that has grown', () => {
    // The regression this exists to catch: an import that quietly lands in the
    // entry chunk, or a web font creeping back into the stylesheet.
    const fat = [...files, { name: 'assets/space-grotesk.woff2', gzip: 14 * K }];
    const { failures } = checkBudget(fat, { critical: 50 * K, total: 200 * K });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/critical path/);
  });

  it('fails on a shell that has grown even when the render path has not', () => {
    // A lazy chunk is still downloaded and stored by the service worker, so it
    // cannot be unbounded just because it is deferred.
    const fat = [...files, { name: 'assets/importDoc-x.js', gzip: 40 * K }];
    const { failures } = checkBudget(fat, { critical: 50 * K, total: 70 * K });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/total shell/);
  });

  it('keeps every on-demand chunk off the critical path', () => {
    // Deferring a chunk and forgetting to list it here reports the win as a
    // loss: the bytes leave the entry chunk and are counted again under their
    // own name. Each of these is reached only by a user action.
    for (const name of ['assets/importDoc-x.js', 'assets/Bee-x.js', 'assets/HelpDialog-x.js']) {
      const { critical } = checkBudget([...files, { name, gzip: 9 * K }], BUDGETS);
      expect(critical, name).toBe(44 * K);
    }
  });

  it('reports both budgets when both are blown', () => {
    expect(checkBudget(files, { critical: 1, total: 1 }).failures).toHaveLength(2);
  });

  it('ships budgets the current build actually meets', () => {
    // A ceiling nobody can hit is not a budget. These are the shipped numbers
    // plus deliberate headroom, and they must stay above the real build.
    expect(BUDGETS.critical).toBeGreaterThan(42 * K);
    expect(BUDGETS.total).toBeGreaterThan(58 * K);
  });
});
