// Small typed helpers shared by the test suite.
//
// Their job is to turn "this might be missing" into a loud, readable failure
// rather than either a non-null assertion (`!`, which says nothing when it is
// wrong) or an optional chain (`?.`, which can turn a broken fixture into a
// passing test).

import { expect } from 'vitest';

/**
 * Assert a value is present, and narrow it.
 *
 * Use wherever a test consumes something the production types describe as
 * nullable — `computeClaimGraph`, `computeCrossRef`, `reconcileRefList` and
 * `claimStats` all return null for an empty document, and a test that has just
 * supplied a non-empty one is asserting that it did.
 */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  expect(value, `expected ${what} to be present`).not.toBe(undefined);
  expect(value, `expected ${what} to be present`).not.toBe(null);
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

/**
 * querySelector that fails the test instead of returning null, and returns the
 * element type asked for.
 *
 * The cast is the point of the helper: `querySelector` is typed by the selector
 * only for known tag names, so `.editor-ta` comes back as `Element` and every
 * `.value` read on it is an error. Naming the type once here beats casting at
 * each of the ~30 call sites.
 */
export function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`no element matched ${selector}`);
  return el as T;
}

// ── WCAG contrast ────────────────────────────────────────────────────────────
// Lives here rather than in palette.test.ts because two test files now check a
// palette: the themes, and the CRT screen filter's replacement for them. The
// alternative — importing it from one test file into the other — would register
// the first file's whole suite inside the second.

const toRgb = (hex: string): number[] => {
  const s = hex.replace('#', '');
  const n =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r = 0, g = 0, b = 0]: number[]): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio between two hex colours (1:1 … 21:1). */
export function contrast(a: string, b: string): number {
  // Defaulted rather than asserted: this file is compiled by the strict project
  // (noUncheckedIndexedAccess), unlike the test files that call it.
  const [hi = 0, lo = 0] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Like `q`, but returns null rather than throwing — for "should not exist" assertions. */
export function maybe<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string
): T | null {
  return root.querySelector(selector) as T | null;
}
