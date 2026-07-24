import { classify } from './extract.js';
import { disKey } from './constants.js';

// ── HTML BUILDER ────────────────────────────────────────────────────────────
export const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  const { signData, termData, artErrors, bareTerms, numErrors, depErrors } = res;
  const spans = [];
  for (const [sign, sData] of Object.entries(signData)) {
    const isDis = dis.has(disKey.sign(sign));
    const sev = isDis ? 'dis' : classify(sign, sData, termData, mode);
    const focused = focusSign === sign;
    for (const p of sData.positions) {
      const cls = sev === 'warn' ? 'h-warn' : sev === 'dis' ? 'h-dis' : 'h-ok';
      spans.push({ start: p.signStart, end: p.signEnd, cls: focused ? cls + ' h-focus' : cls, sign });
      if (sev === 'warn') spans.push({ start: p.termStart, end: p.termEnd, cls: 'h-wt' });
    }
  }
  for (const ae of artErrors) {
    if (dis.has(disKey.art(ae.termStem))) continue;
    spans.push({ start: ae.artStart, end: ae.artEnd, cls: 'h-art' });
  }
  for (const bt of bareTerms) {
    if (dis.has(disKey.bare(bt.termStem))) continue;
    spans.push({ start: bt.termStart, end: bt.termEnd, cls: 'h-bare' });
  }
  for (const ne of numErrors) {
    if (dis.has(disKey.num(ne.key))) continue;
    spans.push({ start: ne.start, end: ne.end, cls: 'h-num' });
  }
  for (const de of depErrors || []) {
    if (dis.has(disKey.dep(de.key))) continue;
    spans.push({ start: de.start, end: de.end, cls: 'h-dep' });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const clean = [];
  let cur = 0;
  for (const sp of spans) { if (sp.start >= cur) { clean.push(sp); cur = sp.end; } }
  let html = '', pos = 0;
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

export function findAtPos(charPos, signData, artErrors) {
  for (const ae of artErrors)
    if (charPos >= ae.artStart && charPos <= ae.artEnd) return { type: 'art', ae };
  for (const [sign, sData] of Object.entries(signData))
    for (const p of sData.positions)
      if (charPos >= p.termStart && charPos <= p.signEnd) return { type: 'sign', sign, pos: p };
  return null;
}
