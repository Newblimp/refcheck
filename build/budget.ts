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

/** One emitted file and what it costs on the wire. */
export interface MeasuredFile {
  /** Bundle-relative name, always forward-slashed ("assets/index-ab12.js"). */
  name: string;
  /** Size in bytes after gzip. */
  gzip: number;
}

/** The two ceilings, in bytes of gzipped transfer. */
export interface Budgets {
  critical: number;
  total: number;
}

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
export const BUDGETS: Budgets = {
  critical: 50 * 1024,
  total: 70 * 1024,
};

/**
 * Files that are fetched on demand, not part of the initial render path.
 *
 * Deferring a chunk without adding it here reports the win as a LOSS — the
 * bytes leave the entry chunk and are counted against `critical` again under
 * their own name, plus the chunk's own overhead.
 */
const LAZY = /^assets\/(importDoc|Bee|HelpDialog|crt)-|\.svg$/;

/** Compare a measured bundle against the budgets. */
export function checkBudget(
  files: MeasuredFile[],
  budgets: Budgets
): { critical: number; total: number; failures: string[] } {
  const critical = files.filter((f) => !LAZY.test(f.name)).reduce((sum, f) => sum + f.gzip, 0);
  const total = files.reduce((sum, f) => sum + f.gzip, 0);

  const failures: string[] = [];
  if (critical > budgets.critical)
    failures.push(`critical path ${kb(critical)} exceeds budget ${kb(budgets.critical)}`);
  if (total > budgets.total)
    failures.push(`total shell ${kb(total)} exceeds budget ${kb(budgets.total)}`);
  return { critical, total, failures };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** Measure every file in a built directory. */
export function measure(dir: string): MeasuredFile[] {
  const out: MeasuredFile[] = [];
  const walk = (d: string) => {
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

// CLI: `node build/budget.ts [dist]` — Node strips the types itself, which is
// why tsconfig.json sets `erasableSyntaxOnly`: a construct Node cannot strip
// (an enum, a namespace) would type-check here and then fail to run in CI.
if (process.argv[1] && process.argv[1].endsWith('budget.ts')) {
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
