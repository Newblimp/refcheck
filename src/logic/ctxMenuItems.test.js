import { describe, it, expect } from 'vitest';
import { ctxMenuItems } from './ctxMenuItems.js';
import { extractData } from './extract.js';
import { findAtPos } from './buildHtml.js';
import { disKey } from './constants.js';
import { T } from '../i18n.js';

// The menu used to be built inside App, so it could only be exercised by
// mounting the whole app in jsdom. It is pure now.
const t = T.en;
const at = (text, pos, opts = {}) => {
  const res = extractData(text, opts.lang || 'en', {}, true, !!opts.claims);
  const found = findAtPos(pos, res.signData, res.artErrors, res.bareTerms);
  return ctxMenuItems(found, { t, lang: opts.lang || 'en', dis: opts.dis || new Set() });
};
const labels = (menu) => menu.items.filter((i) => !i.sep).map((i) => i.label);
const action = (menu, a) => menu.items.find((i) => i.a === a);

const TEXT = 'The housing 12 is fixed. The casing 12 is fixed. Another housing.';

describe('ctxMenuItems', () => {
  it('returns null when the caret is on nothing actionable', () => {
    // "fixed" is neither a sign, an article, nor a term known under a sign.
    // (Position 0 would NOT do: "The" there is itself a first-use article error.)
    expect(at(TEXT, TEXT.indexOf('fixed'))).toBeNull();
    expect(ctxMenuItems(null, { t, lang: 'en', dis: new Set() })).toBeNull();
  });

  it('offers extend and dismiss on a sign, titled with the sign', () => {
    const menu = at(TEXT, TEXT.indexOf('12'));
    expect(menu.label).toBe('Sign 12');
    expect(action(menu, 'extend')).toBeDefined();
    expect(action(menu, 'toggle-dis').d.key).toBe(disKey.sign('12'));
  });

  it('offers reduce only once the term is wider than its base noun', () => {
    // One word in front of the sign → nothing to reduce to.
    expect(action(at(TEXT, TEXT.indexOf('12')), 'reduce')).toBeUndefined();
    const wide = 'The first bearing 20 turns. The first bearing 20 is fitted.';
    const menu = at(wide, wide.indexOf('20'));
    // The ordinal detector widened it to two words, so reducing is meaningful.
    expect(action(menu, 'extend').d.cur).toBe(2);
    expect(action(menu, 'reduce')).toBeDefined();
  });

  it('offers writing the sign in on a bare term with exactly one sign', () => {
    const menu = at(TEXT, TEXT.lastIndexOf('housing') + 2);
    expect(menu.label).toBe(t.ctxTermLbl('housing'));
    expect(action(menu, 'insert-sign').d.sign).toBe('12');
  });

  it('does not offer a sign when the term is known under two', () => {
    // "housing" carries both 12 and 14 → choosing is the drafter's call.
    const two = 'The housing 12 is fixed. The housing 14 is fixed. Another housing.';
    const menu = at(two, two.lastIndexOf('housing') + 2);
    expect(action(menu, 'insert-sign')).toBeUndefined();
    // …but extending and dismissing are still on offer.
    expect(action(menu, 'extend')).toBeDefined();
    expect(action(menu, 'toggle-dis')).toBeDefined();
  });

  it('offers only dismissal on an article, and titles it with the article', () => {
    const art = 'The housing 12 comprises a housing 12.';
    const menu = at(art, art.indexOf('The'));
    expect(menu.label).toBe('Article: the');
    expect(action(menu, 'extend')).toBeUndefined();
    expect(action(menu, 'toggle-dis').d.key).toBe(disKey.art('hous'));
  });

  it('flips a dismissed entry to Restore rather than offering it twice', () => {
    const dis = new Set([disKey.sign('12')]);
    const menu = at(TEXT, TEXT.indexOf('12'), { dis });
    expect(action(menu, 'toggle-dis').label).toMatch(/^↩ Restore/);
  });

  it('always ends with dismiss-all, and adds restore-all only when something is dismissed', () => {
    expect(action(at(TEXT, TEXT.indexOf('12')), 'restore-all')).toBeUndefined();
    const dis = new Set([disKey.sign('99')]);
    const menu = at(TEXT, TEXT.indexOf('12'), { dis });
    expect(action(menu, 'dis-all')).toBeDefined();
    expect(action(menu, 'restore-all').label).toContain('(1)');
  });

  it('labels in the language it is handed', () => {
    const de = 'Das Gehäuse 12 ist fest. Die Verkleidung 12 ist fest.';
    const res = extractData(de, 'de');
    const found = findAtPos(de.indexOf('12'), res.signData, res.artErrors, res.bareTerms);
    const menu = ctxMenuItems(found, { t: T.de, lang: 'de', dis: new Set() });
    expect(labels(menu)).toContain(T.de.extendTerm(1));
    expect(labels(menu)).toContain(T.de.disAll);
  });
});
