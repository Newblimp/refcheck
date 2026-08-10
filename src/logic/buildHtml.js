import { eachErrorSpan } from './errorSpans.js';
import { escapeMarkup } from './escape.js';
import { ERROR_KINDS } from './errorKinds.js';

// ── HTML BUILDER ────────────────────────────────────────────────────────────

// Highlight classes, paired with the error kinds they render. These names are a
// contract with styles.css — the pure logic layer has no other link to the
// stylesheet, so a rename there silently stops highlighting. A test asserts
// every class here is defined in styles.css.
//
// The sign severities are listed here because signs are not an ERROR_KINDS row
// (see errorKinds.js); the four error categories bring their own class along, so
// adding a category cannot forget to add its highlight.
export const HL = {
  warn: 'h-warn', // a sign with an inconsistency
  dis: 'h-dis', // a sign whose errors were dismissed
  ok: 'h-ok', // a consistent sign
  signTerm: 'h-wt', // the term attached to a warned sign
  focus: 'h-focus', // added to the sign the sidebar currently focuses
  ...Object.fromEntries(ERROR_KINDS.map((k) => [k.id, k.hl])),
};

// Re-exported under its historical name; the implementation is shared with the
// .docx writer now.
export const esc = escapeMarkup;

/**
 * Build the highlighted HTML for the backdrop overlay. Invariant: stripping the
 * <mark> tags from the output must reproduce esc(text) exactly, or the backdrop
 * misaligns with the textarea (guarded by a test).
 * @param {string} text
 * @param {import('./extract.js').ExtractResult} res
 * @param {'description'|'claims'} mode
 * @param {Set<string>} dis       Dismissal keys
 * @param {string|null} focusSign Sign to mark with h-focus
 */
export function buildHtml(text, res, mode, dis, focusSign) {
  if (!text) return '';
  const spans = [];
  eachErrorSpan(res, mode, dis, (sp) => {
    if (sp.kind === 'sign') {
      const cls = HL[sp.sev];
      spans.push({
        start: sp.start,
        end: sp.end,
        cls: focusSign === sp.sign ? `${cls} ${HL.focus}` : cls,
        sign: sp.sign,
      });
    } else {
      spans.push({ start: sp.start, end: sp.end, cls: HL[sp.kind] });
    }
  });
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const clean = [];
  let cur = 0;
  for (const sp of spans) {
    if (sp.start >= cur) {
      clean.push(sp);
      cur = sp.end;
    }
  }
  let html = '',
    pos = 0;
  for (const sp of clean) {
    if (sp.start > pos) html += esc(text.slice(pos, sp.start));
    const ds = sp.sign ? ` data-sign="${sp.sign}"` : '';
    html += `<mark class="${sp.cls}"${ds}>${esc(text.slice(sp.start, sp.end))}</mark>`;
    pos = sp.end;
  }
  if (pos < text.length) html += esc(text.slice(pos));
  // Vertical-alignment sentinel. A <textarea> reserves an empty line box for a
  // trailing "\n", but a white-space:pre-wrap div drops its final one — so a
  // buffer ending in a newline leaves the backdrop one line shorter than the
  // textarea, and scrolled to the bottom the highlights drift below the text
  // ("double text"). Append a newline the div will drop: it restores the
  // reserved line so both layers share one scrollHeight (a no-op when the text
  // does not end in a newline, since the div drops it either way).
  return html + '\n';
}

/**
 * What sits at a character position, for the editor's context menu.
 *
 * Bare terms are searched last and cannot overlap the sign spans anyway (a term
 * already attached to a sign is not bare), so the order only decides ties
 * between an article and the term behind it — which the article should win, as
 * before.
 */
export function findAtPos(charPos, signData, artErrors, bareTerms = []) {
  for (const ae of artErrors)
    if (charPos >= ae.artStart && charPos <= ae.artEnd) return { type: 'art', ae };
  for (const [sign, sData] of Object.entries(signData))
    for (const p of sData.positions)
      if (charPos >= p.termStart && charPos <= p.signEnd) return { type: 'sign', sign, pos: p };
  for (const bt of bareTerms)
    if (charPos >= bt.termStart && charPos <= bt.termEnd) return { type: 'bare', bt };
  return null;
}
