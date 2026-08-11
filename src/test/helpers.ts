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

/** Like `q`, but returns null rather than throwing — for "should not exist" assertions. */
export function maybe<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string
): T | null {
  return root.querySelector(selector) as T | null;
}
