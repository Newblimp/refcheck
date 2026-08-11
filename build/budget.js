// Payload budget for the built app.
//
// perf.test.js guards how long extraction TAKES; nothing guarded how much the
// app SHIPS, and that turned out to be where the real cost was — 95.8 KB of web
// font, more than React and the application code together, invisible to every
// test in the suite. A budget is the only thing that keeps a payload win from
// eroding one convenient import at a time.
//
// Run as `npm run budget` after `npm run build`. The check itself is a pure
// function so it can be unit-tested without building anything.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Budgets in bytes of gzipped transfer.
 *
 * `critical` is what must arrive before the app can render: the HTML document
 * (which now carries the stylesheet inline) plus the entry chunk and everything
 * it statically imports. `total` is the whole precached shell, which is what a
 * first visit ends up storing for offline use.
 *
 * These are ceilings with deliberate headroom, not targets — a build that lands
 * near one is a build worth looking at.
 */
export const BUDGETS = {
  critical: 50 * 1024,
  total: 70 * 1024,
};

/** Files that are fetched on demand, not part of the initial render path. */
const LAZY = /^assets\/(importDoc|Bee)-|\.svg$/;

/**
 * Compare a measured bundle against the budgets.
 *
 * @param {{name: string, gzip: number}[]} files  every emitted file
 * @param {{critical: number, total: number}} budgets
 * @returns {{critical: number, total: number, failures: string[]}}
 */
export function checkBudget(files, budgets) {
  const critical = files.filter((f) => !LAZY.test(f.name)).reduce((sum, f) => sum + f.gzip, 0);
  const total = files.reduce((sum, f) => sum + f.gzip, 0);

  const failures = [];
  if (critical > budgets.critical)
    failures.push(`critical path ${kb(critical)} exceeds budget ${kb(budgets.critical)}`);
  if (total > budgets.total)
    failures.push(`total shell ${kb(total)} exceeds budget ${kb(budgets.total)}`);
  return { critical, total, failures };
}

/** @param {number} n */
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/**
 * Measure every file in a built directory.
 * @param {string} dir
 * @returns {{name: string, gzip: number}[]}
 */
export function measure(dir) {
  /** @type {{name: string, gzip: number}[]} */
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const name = relative(dir, full).split('\\').join('/');
      // sw.js is infrastructure, not part of what the page loads to render.
      if (name === 'sw.js') continue;
      out.push({ name, gzip: gzipSync(readFileSync(full)).length });
    }
  };
  walk(dir);
  return out;
}

// CLI: `node build/budget.js [dist]`
if (process.argv[1] && process.argv[1].endsWith('budget.js')) {
  const dir = process.argv[2] || 'dist';
  const files = measure(dir);
  const { critical, total, failures } = checkBudget(files, BUDGETS);

  for (const f of [...files].sort((a, b) => b.gzip - a.gzip))
    console.log(`  ${kb(f.gzip).padStart(9)}  ${f.name}`);
  console.log(`\n  critical path  ${kb(critical)} / ${kb(BUDGETS.critical)}`);
  console.log(`  total shell    ${kb(total)} / ${kb(BUDGETS.total)}`);

  if (failures.length) {
    console.error('\nPayload budget exceeded:');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('\n  within budget');
}
