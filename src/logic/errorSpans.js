import { classify } from './extract.ts';
import { disKey } from './constants.ts';
import { ERROR_KINDS, KIND_BY_ID, kindItems } from './errorKinds.js';

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

// The span is a discriminated union on `kind` rather than one shape with four
// optional fields. That is not decoration: `sev` is present exactly when the
// span is a sign, and with it optional every consumer had to either assert or
// risk indexing HL with undefined. Narrowing on `kind` now proves it.
//
// The two sign shapes are separate typedefs carrying ONE literal `kind` each,
// rather than one typedef with `'sign'|'signTerm'`. That is a JSDoc constraint,
// not a stylistic choice: a member whose discriminant is a union of literals is
// not eliminated by narrowing, so `getAllErrors` could not reach `sp.item`
// without an assertion. One literal per member and it narrows.

/**
 * A sign occurrence.
 * @typedef {Object} SignSpan
 * @property {'sign'} kind
 * @property {number} start
 * @property {number} end
 * @property {string} sign
 * @property {'warn'|'ok'|'dis'} sev
 * @property {string} term       The term stem of THIS occurrence
 */

/**
 * The term attached to a warned sign — highlighted alongside it, but never a
 * navigation target of its own.
 * @typedef {Object} SignTermSpan
 * @property {'signTerm'} kind
 * @property {number} start
 * @property {number} end
 * @property {string} sign
 * @property {'warn'|'ok'|'dis'} sev
 * @property {string} term
 */

/**
 * One of the four ERROR_KINDS categories.
 * @typedef {Object} KindSpan
 * @property {'art'|'bare'|'num'|'dep'} kind
 * @property {number} start
 * @property {number} end
 * @property {string|null} term  null for the categories that name no term
 * @property {Object} item       The originating error record
 */

/** @typedef {SignSpan|SignTermSpan|KindSpan} ErrorSpan */

/**
 * Visit every span of interest, in no particular order.
 *
 * Signs are reported whatever their severity — including dismissed ones, which
 * the backdrop still renders (greyed) even though the navigator skips them. The
 * four error categories are reported only when not dismissed, which is what both
 * consumers want.
 *
 * @param {import('./extract.ts').ExtractResult} res
 * @param {'description'|'claims'} mode
 * @param {Set<string>} dis
 * @param {(span: ErrorSpan) => void} visit
 */
export function eachErrorSpan(res, mode, dis, visit) {
  const { signData, termData } = res;

  for (const [sign, sData] of Object.entries(signData)) {
    const sev = dis.has(disKey.sign(sign)) ? 'dis' : classify(sData, termData, mode);
    for (const p of sData.positions) {
      visit({ kind: 'sign', start: p.signStart, end: p.signEnd, sign, sev, term: p.termStem });
      // The term a warned sign is attached to is highlighted alongside it.
      if (sev === 'warn')
        visit({
          kind: 'signTerm',
          start: p.termStart,
          end: p.termEnd,
          sign,
          sev,
          term: p.termStem,
        });
    }
  }
  // The four non-sign categories differ only in the accessors ERROR_KINDS
  // already names, so they are one loop rather than four copies of it.
  for (const kind of ERROR_KINDS) {
    for (const item of kindItems(res, kind)) {
      if (dis.has(kind.disKey(item))) continue;
      visit({
        kind: /** @type {KindSpan['kind']} */ (kind.id),
        start: kind.start(item),
        end: kind.end(item),
        term: kind.term(item),
        item,
      });
    }
  }
}

/**
 * Every active error, in document order — what the status-bar arrows step through.
 * Dismissed signs and dismissed errors are excluded; consistent signs are not
 * errors and are excluded too.
 *
 * @param {import('./extract.ts').ExtractResult} res
 * @param {'description'|'claims'} mode
 * @param {Set<string>} dis
 */
export function getAllErrors(res, mode, dis) {
  const out = [];
  eachErrorSpan(res, mode, dis, (sp) => {
    // Both sign shapes are handled in one branch, so what follows is a KindSpan
    // by elimination — which is also what lets `sp.item` below be reached
    // without an assertion.
    if (sp.kind === 'sign' || sp.kind === 'signTerm') {
      // Only a warned sign is an error to step through, and the term beside it
      // is a highlight rather than a target of its own.
      if (sp.kind === 'signTerm' || sp.sev !== 'warn') return;
      out.push({ type: 'sign', start: sp.start, end: sp.end, sign: sp.sign, term: sp.term });
      return;
    }
    out.push({
      type: sp.kind,
      start: sp.start,
      end: sp.end,
      term: sp.term,
      [KIND_BY_ID[sp.kind].navProp]: sp.item,
    });
  });
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Grouping key for "jump to the next error about the same term" navigation
 * (Ctrl+Shift+↓/↑).
 *
 * Everything that names a term groups by its STEM, so an inconsistent sign, the
 * article in front of it and a bare occurrence of the same noun all belong to
 * one group — that is what makes stepping through "banana" skip "kiwi". Claim
 * numbering and dependency errors have no term at all; they group by category
 * rather than sharing one nameless bucket, which would make the jump behave like
 * the plain next-error arrow for them.
 *
 * @param {{type: string, term?: string|null}} e  An entry from getAllErrors
 */
export function errorGroup(e) {
  return e?.term ? `t:${e.term}` : `k:${e?.type}`;
}
