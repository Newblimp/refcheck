import { describe, it, expect } from 'vitest';
import type { Lang } from './constants.ts';
import { readFileSync } from 'node:fs';
import { ERROR_KINDS, KIND_BY_ID, sameFocus } from './errorKinds.ts';
import type { ErrorKind, ErrorKindId, ErrorRecord } from './errorKinds.ts';
import { must } from '../test/helpers.ts';
import { extractData } from './extract.ts';
import { T } from '../i18n.ts';

// A result carrying at least one error of every category.
const descRes = extractData('The housing 12 comprises a housing 12. Another housing.');
const claimsRes = extractData(
  '1. A device (10) comprising a housing (12).\n3. The device (10) according to claim 9.',
  'en',
  {},
  true,
  true
);
const resFor = (id: ErrorKindId) => (id === 'num' || id === 'dep' ? claimsRes : descRes);
const oneOf = (kind: ErrorKind<ErrorRecord>): ErrorRecord => {
  const items = kind.items(resFor(kind.id));
  expect(items.length, `no ${kind.id} error in the fixture`).toBeGreaterThan(0);
  return must(items[0], `${kind.id} error`);
};

describe('ERROR_KINDS', () => {
  it('has a unique id per row and an index that agrees with it', () => {
    const ids = ERROR_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of ERROR_KINDS) expect(KIND_BY_ID[k.id]).toBe(k);
  });

  // ── The guard that matters most ────────────────────────────────────────────
  // The dismissal prefixes are a STORAGE FORMAT: they sit in users' localStorage
  // under `rsc_dis`. They happen to be first letters, so a "simplification" that
  // derives them from `id` passes every other test in the suite and silently
  // discards every stored dismissal the first time two categories share an
  // initial. Pinning the literal strings is the whole point of this test.
  it('produces the historical dismissal prefixes', () => {
    const expected = { art: 'a:', bare: 'b:', num: 'n:', dep: 'd:' };
    for (const kind of ERROR_KINDS) {
      const key = kind.disKey(oneOf(kind));
      expect(key.startsWith(expected[kind.id]), `${kind.id} → ${key}`).toBe(true);
      // …and the rest of the key is the category's own identity.
      expect(key).toBe(expected[kind.id] + kind.disId(oneOf(kind)));
    }
  });

  it('keeps the historical getAllErrors property names', () => {
    expect(ERROR_KINDS.map((k) => [k.id, k.navProp])).toEqual([
      ['art', 'ae'],
      ['bare', 'bt'],
      ['num', 'ne'],
      ['dep', 'de'],
    ]);
  });

  it('names a field the extractor actually fills', () => {
    for (const kind of ERROR_KINDS) expect(Array.isArray(kind.items(resFor(kind.id)))).toBe(true);
  });

  it('reports a well-formed span for every kind', () => {
    for (const kind of ERROR_KINDS) {
      const e = oneOf(kind);
      expect(Number.isInteger(kind.start(e)), kind.id).toBe(true);
      expect(kind.end(e)).toBeGreaterThan(kind.start(e));
    }
  });

  it('names a term where it has one and null where it does not', () => {
    expect(KIND_BY_ID.art.term(oneOf(KIND_BY_ID.art))).toBeTypeOf('string');
    expect(KIND_BY_ID.bare.term(oneOf(KIND_BY_ID.bare))).toBeTypeOf('string');
    // Claim numbering and dependencies are not about a term; errorGroup relies
    // on this to bucket them by category instead.
    expect(KIND_BY_ID.num.term(oneOf(KIND_BY_ID.num))).toBeNull();
    expect(KIND_BY_ID.dep.term(oneOf(KIND_BY_ID.dep))).toBeNull();
  });

  it('formats a non-empty message in both languages', () => {
    for (const lang of ['en', 'de'])
      for (const kind of ERROR_KINDS) {
        const msg = kind.message(oneOf(kind), T[lang as Lang]);
        expect(typeof msg, `${kind.id}/${lang}`).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      }
  });

  it('uses i18n keys that exist in both languages', () => {
    for (const lang of ['en', 'de'])
      for (const kind of ERROR_KINDS) {
        expect(T[lang as Lang][kind.sectionLbl], `${kind.id}.sectionLbl/${lang}`).toBeTruthy();
        expect(T[lang as Lang][kind.chipLbl], `${kind.id}.chipLbl/${lang}`).toBeTruthy();
      }
  });

  it('matches its own error on a search for its own text', () => {
    // A query that cannot match anything must not be reported as a match, or the
    // sign filter would stop filtering.
    for (const kind of ERROR_KINDS)
      expect(kind.matches(oneOf(kind), 'zzzznotpresent', descRes.termData), kind.id).toBe(false);
    expect(KIND_BY_ID.bare.matches(oneOf(KIND_BY_ID.bare), 'housing', descRes.termData)).toBe(true);
    expect(KIND_BY_ID.num.matches(oneOf(KIND_BY_ID.num), '3', {})).toBe(true);
  });

  // The card takes its colour from --<color> / --<color>-bg rather than from a
  // per-category CSS rule, so those two tokens are the entire stylesheet cost of
  // a new category — and the card renders colourless if they are missing.
  it('has both colour tokens defined in styles.css, in both themes', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const themes = ['dark', 'light'];
    for (const kind of ERROR_KINDS)
      for (const suffix of ['', '-bg']) {
        const token = `--${kind.color}${suffix}:`;
        const count = css.split(token).length - 1;
        expect(count, `${token} defined ${count}× (expected one per theme)`).toBe(themes.length);
      }
  });
});

// The focus comparison focusCycle uses to decide "is this the same thing the
// user clicked last time, or a new cycle?". It has to see the term, or a sign
// card's two chips would read as one cycle and clicking the second would
// advance the first instead of starting over.
describe('sameFocus', () => {
  it('matches a sign focus with itself and separates the two chips of one sign', () => {
    expect(sameFocus({ type: 'sign', key: '22' }, { type: 'sign', key: '22' })).toBe(true);
    expect(
      sameFocus(
        { type: 'sign', key: '22', term: 'shaft' },
        { type: 'sign', key: '22', term: 'shaft' }
      )
    ).toBe(true);
    expect(
      sameFocus(
        { type: 'sign', key: '22', term: 'shaft' },
        { type: 'sign', key: '22', term: 'axl' }
      )
    ).toBe(false);
    // The card itself is not either chip.
    expect(sameFocus({ type: 'sign', key: '22', term: 'shaft' }, { type: 'sign', key: '22' })).toBe(
      false
    );
  });

  it('separates signs, kinds and offsets, and treats null as matching nothing', () => {
    expect(sameFocus({ type: 'sign', key: '22' }, { type: 'sign', key: '24' })).toBe(false);
    expect(sameFocus({ type: 'art', key: 4 }, { type: 'bare', key: 4 })).toBe(false);
    expect(sameFocus({ type: 'art', key: 4 }, { type: 'art', key: 9 })).toBe(false);
    expect(sameFocus(null, { type: 'art', key: 4 })).toBe(false);
    expect(sameFocus(null, null)).toBe(false);
  });
});
