import { classify } from './extract.js';
import { disKey } from './constants.js';

// ── ERROR SPANS ─────────────────────────────────────────────────────────────
//
// One traversal of "everything the app considers an error, and where it sits in
// the text", shared by the two consumers that need it:
//
//   • buildHtml   — turns spans into <mark> elements for the backdrop
//   • getAllErrors — turns them into a document-ordered navigation list
//
// Both used to walk the same five categories with the same dismissal rules in
// their own copy of the loop. Keeping the categories in one place means adding a
// sixth error type touches one function rather than two that must be kept in
// step — and it stops the highlighter and the error navigator from silently
// disagreeing about what counts as an error.

/**
 * @typedef {Object} ErrorSpan
 * @property {'sign'|'signTerm'|'art'|'bare'|'num'|'dep'} kind
 * @property {number} start
 * @property {number} end
 * @property {string} [sign]     'sign'/'signTerm' only
 * @property {'warn'|'ok'|'dis'} [sev]  'sign' only
 * @property {Object} [item]     The originating error record, for the rest
 */

/**
 * Visit every span of interest, in no particular order.
 *
 * Signs are reported whatever their severity — including dismissed ones, which
 * the backdrop still renders (greyed) even though the navigator skips them. The
 * four error categories are reported only when not dismissed, which is what both
 * consumers want.
 *
 * @param {import('./extract.js').ExtractResult} res
 * @param {'description'|'claims'} mode
 * @param {Set<string>} dis
 * @param {(span: ErrorSpan) => void} visit
 */
export function eachErrorSpan(res, mode, dis, visit) {
  const { signData, termData, artErrors, bareTerms, numErrors, depErrors } = res;

  for (const [sign, sData] of Object.entries(signData)) {
    const sev = dis.has(disKey.sign(sign)) ? 'dis' : classify(sign, sData, termData, mode);
    for (const p of sData.positions) {
      visit({ kind: 'sign', start: p.signStart, end: p.signEnd, sign, sev });
      // The term a warned sign is attached to is highlighted alongside it.
      if (sev === 'warn')
        visit({ kind: 'signTerm', start: p.termStart, end: p.termEnd, sign, sev });
    }
  }
  for (const ae of artErrors) {
    if (dis.has(disKey.art(ae.termStem))) continue;
    visit({ kind: 'art', start: ae.artStart, end: ae.artEnd, item: ae });
  }
  for (const bt of bareTerms) {
    if (dis.has(disKey.bare(bt.termStem))) continue;
    visit({ kind: 'bare', start: bt.termStart, end: bt.termEnd, item: bt });
  }
  for (const ne of numErrors) {
    if (dis.has(disKey.num(ne.key))) continue;
    visit({ kind: 'num', start: ne.start, end: ne.end, item: ne });
  }
  for (const de of depErrors || []) {
    if (dis.has(disKey.dep(de.key))) continue;
    visit({ kind: 'dep', start: de.start, end: de.end, item: de });
  }
}

// The property each error category is carried under in getAllErrors' output.
// Kept as data so the shapes stay obviously parallel.
const NAV_PROP = { art: 'ae', bare: 'bt', num: 'ne', dep: 'de' };

/**
 * Every active error, in document order — what the status-bar arrows step through.
 * Dismissed signs and dismissed errors are excluded; consistent signs are not
 * errors and are excluded too.
 *
 * @param {import('./extract.js').ExtractResult} res
 * @param {'description'|'claims'} mode
 * @param {Set<string>} dis
 */
export function getAllErrors(res, mode, dis) {
  const out = [];
  eachErrorSpan(res, mode, dis, (sp) => {
    if (sp.kind === 'signTerm') return; // the sign itself is the navigation target
    if (sp.kind === 'sign') {
      if (sp.sev !== 'warn') return;
      out.push({ type: 'sign', start: sp.start, end: sp.end, sign: sp.sign });
      return;
    }
    out.push({ type: sp.kind, start: sp.start, end: sp.end, [NAV_PROP[sp.kind]]: sp.item });
  });
  out.sort((a, b) => a.start - b.start);
  return out;
}
