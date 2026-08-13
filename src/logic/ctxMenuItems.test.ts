import { describe, it, expect } from 'vitest';
import { must } from '../test/helpers.ts';
import { ctxMenuItems } from './ctxMenuItems.ts';
import type { CtxAction, CtxMenu, CtxMenuItem } from './ctxMenuItems.ts';
import type { Lang } from './constants.ts';
import { extractData } from './extract.ts';
import { findAtPos } from './buildHtml.ts';
import { disKey } from './constants.ts';
import { T } from '../i18n.ts';

// The menu used to be built inside App, so it could only be exercised by
// mounting the whole app in jsdom. It is pure now.
const t = T.en;
interface AtOpts {
  lang?: Lang;
  claims?: boolean;
  dis?: Set<string>;
}

const at = (text: string, pos: number, opts: AtOpts = {}): CtxMenu | null => {
  const lang = opts.lang ?? 'en';
  const res = extractData(text, lang, {}, true, !!opts.claims);
  // Not `must`: a caret on nothing actionable is a case this file asserts.
  const found = findAtPos(pos, res.signData, res.artErrors, res.bareTerms);
  // termData is passed exactly as App passes it, so the sign-correction offer
  // is exercised by every case here rather than only by the ones about it.
  return ctxMenuItems(found, {
    t: opts.lang === 'de' ? T.de : t,
    lang,
    dis: opts.dis ?? new Set(),
    termData: res.termData,
  });
};
/** `at` for the cases that go on to read the menu. */
const menuAt = (text: string, pos: number, opts: AtOpts = {}) => must(at(text, pos, opts), 'menu');
const labels = (menu: CtxMenu) =>
  menu.items.filter((i) => !('sep' in i)).map((i) => ('label' in i ? i.label : ''));
/** The menu item for one action, typed as that action's own member. */
type ItemFor<A extends CtxAction> = Extract<CtxMenuItem, { a: A }>;
const action = <A extends CtxAction>(menu: CtxMenu, a: A): ItemFor<A> | undefined =>
  menu.items.find((i): i is ItemFor<A> => 'a' in i && i.a === a);

const TEXT = 'The housing 12 is fixed. The casing 12 is fixed. Another housing.';

describe('ctxMenuItems', () => {
  it('returns null when the caret is on nothing actionable', () => {
    // "fixed" is neither a sign, an article, nor a term known under a sign.
    // (Position 0 would NOT do: "The" there is itself a first-use article error.)
    expect(at(TEXT, TEXT.indexOf('fixed'))).toBeNull();
    expect(ctxMenuItems(null, { t, lang: 'en', dis: new Set() })).toBeNull();
  });

  it('offers extend and dismiss on a sign, titled with the sign', () => {
    const menu = menuAt(TEXT, TEXT.indexOf('12'));
    expect(menu.label).toBe('Sign 12');
    expect(action(menu, 'extend')).toBeDefined();
    expect(must(action(menu, 'toggle-dis')).d.key).toBe(disKey.sign('12'));
  });

  it('offers reduce only once the term is wider than its base noun', () => {
    // One word in front of the sign → nothing to reduce to.
    expect(action(menuAt(TEXT, TEXT.indexOf('12')), 'reduce')).toBeUndefined();
    const wide = 'The first bearing 20 turns. The first bearing 20 is fitted.';
    const menu = menuAt(wide, wide.indexOf('20'));
    // The ordinal detector widened it to two words, so reducing is meaningful.
    expect(must(action(menu, 'extend')).d.cur).toBe(2);
    expect(action(menu, 'reduce')).toBeDefined();
  });

  it('offers writing the sign in on a bare term with exactly one sign', () => {
    const menu = menuAt(TEXT, TEXT.lastIndexOf('housing') + 2);
    expect(menu.label).toBe(t.ctxTermLbl('housing'));
    expect(must(action(menu, 'insert-sign')).d.sign).toBe('12');
  });

  it('does not offer a sign when the term is known under two', () => {
    // "housing" carries both 12 and 14 → choosing is the drafter's call.
    const two = 'The housing 12 is fixed. The housing 14 is fixed. Another housing.';
    const menu = menuAt(two, two.lastIndexOf('housing') + 2);
    expect(action(menu, 'insert-sign')).toBeUndefined();
    // …but extending and dismissing are still on offer.
    expect(action(menu, 'extend')).toBeDefined();
    expect(action(menu, 'toggle-dis')).toBeDefined();
  });

  it('offers only dismissal on an article, and titles it with the article', () => {
    const art = 'The housing 12 comprises a housing 12.';
    const menu = menuAt(art, art.indexOf('The'));
    expect(menu.label).toBe('Article: the');
    expect(action(menu, 'extend')).toBeUndefined();
    expect(must(action(menu, 'toggle-dis')).d.key).toBe(disKey.art('hous'));
  });

  it('flips a dismissed entry to Restore rather than offering it twice', () => {
    const dis = new Set([disKey.sign('12')]);
    const menu = menuAt(TEXT, TEXT.indexOf('12'), { dis });
    expect(must(action(menu, 'toggle-dis')).label).toMatch(/^↩ Restore/);
  });

  it('always ends with dismiss-all, and adds restore-all only when something is dismissed', () => {
    expect(action(menuAt(TEXT, TEXT.indexOf('12')), 'restore-all')).toBeUndefined();
    const dis = new Set([disKey.sign('99')]);
    const menu = menuAt(TEXT, TEXT.indexOf('12'), { dis });
    expect(action(menu, 'dis-all')).toBeDefined();
    expect(must(action(menu, 'restore-all')).label).toContain('(1)');
  });

  // A mistyped sign looks exactly like a term-to-sign inconsistency; the term's
  // own frequencies say which occurrence is the slip. See logic/signFix.ts.
  it('offers to correct a sign the term is usually written without', () => {
    const text = 'Begriff 1\nBegriff 2\nBegriff 1';
    const menu = menuAt(text, text.indexOf('2'), { lang: 'de' });
    const fix = must(action(menu, 'fix-sign'));
    expect(fix.d.from).toBe('2');
    expect(fix.d.to).toBe('1');
    expect(fix.d.pos.signStart).toBe(text.indexOf('2'));
    expect(fix.label).toBe(T.de.fixSign('2', '1', 2));
  });

  it('offers it from the term as well as from the sign', () => {
    // findAtPos covers the term span, which is where a drafter reading the
    // sentence actually right-clicks.
    const text = 'Begriff 1\nBegriff 2\nBegriff 1';
    const menu = menuAt(text, text.indexOf('Begriff 2'), { lang: 'de' });
    expect(must(action(menu, 'fix-sign')).d.to).toBe('1');
  });

  it('does not offer it on the occurrence that already carries the usual sign', () => {
    const text = 'Begriff 1\nBegriff 2\nBegriff 1';
    expect(action(menuAt(text, text.indexOf('1'), { lang: 'de' }), 'fix-sign')).toBeUndefined();
  });

  it('does not offer it on an even split, or on a term with one sign', () => {
    const even = 'Begriff 1\nBegriff 2';
    expect(action(menuAt(even, even.indexOf('2'), { lang: 'de' }), 'fix-sign')).toBeUndefined();
    expect(action(menuAt(TEXT, TEXT.indexOf('12')), 'fix-sign')).toBeUndefined();
  });

  it('labels in the language it is handed', () => {
    const de = 'Das Gehäuse 12 ist fest. Die Verkleidung 12 ist fest.';
    const res = extractData(de, 'de');
    const found = must(findAtPos(de.indexOf('12'), res.signData, res.artErrors, res.bareTerms));
    const menu = must(ctxMenuItems(found, { t: T.de, lang: 'de', dis: new Set() }));
    expect(labels(menu)).toContain(T.de.extendTerm(1));
    expect(labels(menu)).toContain(T.de.disAll);
  });
});
