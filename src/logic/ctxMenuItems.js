import { disKey } from './constants.js';
import { stem } from './stem.js';

// ── EDITOR CONTEXT MENU ──────────────────────────────────────────────────────
// Turns "what sits at the caret" (findAtPos) into the menu to show for it.
//
// Pure, so it is testable without a DOM: App supplies the resolved i18n strings
// and the dismissal set, and gets back a label and an item list. The actions are
// named, not bound — App's handleCtxAction decides what each one does.
//
// The menu is deliberately per-category rather than driven by ERROR_KINDS: a
// sign offers extend/reduce plus its own dismissal, a bare term additionally
// offers writing the missing sign in, and an article offers only dismissal.
// There is no uniform behaviour here for a table to drive.

/**
 * Extend / reduce, offered for whatever term the caret is on.
 *
 * The current width is read off the term AS RECORDED, not off `mwo`: the
 * reference list and the ordinal detector widen terms too, and a menu that
 * offered "Extend term (1 word)" on a term already showing two words would both
 * mislabel it and, on the next click, widen it by nothing.
 */
function termItems(rawTerm, lang, t) {
  const words = rawTerm.split(' ');
  const bs = stem(words[words.length - 1], lang);
  const cur = words.length;
  const items = [{ label: t.extendTerm(cur), a: 'extend', d: { bs, cur } }];
  if (cur > 1) items.push({ label: t.reduceTerm, a: 'reduce', d: { bs, cur } });
  return items;
}

/**
 * @param {ReturnType<import('./buildHtml.js').findAtPos>} found
 * @param {{t: object, lang: 'en'|'de', dis: Set<string>}} ctx
 * @returns {{label: string, items: object[]}|null} null when the caret is on
 *   nothing the menu can act on.
 */
export function ctxMenuItems(found, { t, lang, dis }) {
  if (!found) return null;
  const disCt = dis.size;
  const items = [];
  let label;

  if (found.type === 'sign') {
    const { sign, pos: p } = found;
    label = `Sign ${sign}`;
    items.push(...termItems(p.term, lang, t));
    items.push({ sep: true });
    const key = disKey.sign(sign);
    items.push({
      label: dis.has(key) ? `↩ Restore "${sign}"` : t.disSign(sign),
      a: 'toggle-dis',
      d: { key },
    });
  } else if (found.type === 'bare') {
    const { bt } = found;
    label = t.ctxTermLbl(bt.term);
    items.push(...termItems(bt.term, lang, t));
    // Writing the sign in is only offered when the term has exactly one — with
    // two or more, choosing between them is the drafter's call, not ours.
    if (bt.signs.length === 1) {
      items.push({ sep: true });
      items.push({
        label: t.insertSign(bt.signs[0]),
        a: 'insert-sign',
        d: { bt, sign: bt.signs[0] },
      });
    }
    items.push({ sep: true });
    const key = disKey.bare(bt.termStem);
    items.push({
      label: dis.has(key) ? `↩ ${t.restoreOne}` : t.disBare(bt.term),
      a: 'toggle-dis',
      d: { key },
    });
  } else {
    const { ae } = found;
    label = `Article: ${ae?.article}`;
    const key = disKey.art(ae.termStem);
    items.push({
      label: dis.has(key) ? `↩ Restore article` : t.disArt(ae.termStem),
      a: 'toggle-dis',
      d: { key },
    });
  }

  items.push({ sep: true });
  items.push({ label: t.disAll, a: 'dis-all', v: 'warn' });
  if (disCt) items.push({ label: `↩ ${t.restoreAll} (${disCt})`, a: 'restore-all' });
  return { label, items };
}
