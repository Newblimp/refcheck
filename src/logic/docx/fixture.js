// Test helper: build real .docx bytes in memory, so no binary fixture has to be
// committed. Shared by read/write/import tests.
import { zipSync, strToU8 } from 'fflate';
import { escapeMarkup } from '../escape.js';

/** One `<w:p>`. opts: {style, num, ilvl, numId, bold, italic, raw} */
export function para(text, opts = {}) {
  if (opts.raw) return opts.raw;
  const props = [];
  if (opts.style) props.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.num) {
    props.push(
      `<w:numPr><w:ilvl w:val="${opts.ilvl ?? 0}"/><w:numId w:val="${opts.numId ?? 1}"/></w:numPr>`
    );
  }
  const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  const rPr =
    opts.bold || opts.italic
      ? `<w:rPr>${opts.bold ? '<w:b/>' : ''}${opts.italic ? '<w:i/>' : ''}</w:rPr>`
      : '';
  const esc = escapeMarkup(text);
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc}</w:t></w:r></w:p>`;
}

export function documentXml(body) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`
  );
}

/**
 * Assert that a string is well-formed XML, the way Word will judge it.
 *
 * `docxXmlToParagraphs` is a tag scanner and will happily read a document whose
 * tags do not nest — which is exactly what a bad splice produces, and exactly
 * what Word rejects with "unreadable content". So the round-trip tests cannot
 * check this by re-importing; they have to look at the markup.
 *
 * Deliberately a small hand-rolled check rather than DOMParser: the logic tests
 * run in the `node` environment, which has no DOM.
 *
 * @returns {string} '' when well-formed, otherwise a description of the fault
 */
export function xmlFault(xml) {
  const body = String(xml).replace(/^\s*<\?xml[^>]*\?>/, '');
  const stack = [];
  const tag = /<(\/?)([A-Za-z0-9:_.-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m,
    last = 0;
  while ((m = tag.exec(body)) !== null) {
    // Text between tags may not contain a stray '<' or '>'; a mis-cut splice
    // leaves fragments like "/w:t><w:br/>" lying in the character data.
    const between = body.slice(last, m.index);
    if (/[<>]/.test(between))
      return `stray markup in text: ${JSON.stringify(between.slice(0, 40))}`;
    last = m.index + m[0].length;
    if (m[2].startsWith('?') || m[2].startsWith('!')) continue;
    if (m[4] === '/') continue;
    if (m[1] === '/') {
      const open = stack.pop();
      if (open !== m[2]) return `</${m[2]}> closes <${open || 'nothing'}>`;
    } else stack.push(m[2]);
  }
  if (/[<>]/.test(body.slice(last))) return 'stray markup after the last tag';
  if (stack.length) return `unclosed <${stack[stack.length - 1]}>`;
  return '';
}

/** A complete .docx (plus a header part, to prove headers are excluded). */
export function makeDocx(body, extra = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    '_rels/.rels': strToU8('<Relationships/>'),
    'word/document.xml': strToU8(documentXml(body)),
    'word/header1.xml': strToU8(documentXml(para('PATENT ATTORNEYS LLP — CONFIDENTIAL'))),
    'word/footer1.xml': strToU8(documentXml(para('Page 1 of 9'))),
    'word/comments.xml': strToU8(documentXml(para('Reviewer: check sign 12 here'))),
    ...extra,
  });
}

/** A small but realistic German application. */
export const DE_BODY = [
  para('Zusammenfassung', { style: 'Heading1' }),
  para('Die Erfindung betrifft eine Vorrichtung 10.'),
  para('Kurzbeschreibung der Zeichnungen', { style: 'Heading1' }),
  para('Fig. 1 zeigt eine Vorrichtung 10.'),
  para('Detaillierte Beschreibung', { style: 'Heading1' }),
  para('Die Vorrichtung 10 umfasst ein Gehäuse 12.'),
  para('Das Gehäuse 12 besteht aus Aluminium.'),
  para('Patentansprüche', { style: 'Heading1' }),
  para('Vorrichtung (10) mit einem Gehäuse (12).', { num: true }),
  para('Vorrichtung (10) nach Anspruch 1.', { num: true }),
  para('Bezugszeichenliste', { style: 'Heading1' }),
  para('10 Vorrichtung'),
  para('12 Gehäuse'),
].join('');

/** The same shape in English, with claim numbers typed rather than auto. */
export const EN_BODY = [
  para('ABSTRACT', { style: 'Heading1' }),
  para('A device 10 is disclosed.'),
  para('BRIEF DESCRIPTION OF THE DRAWINGS', { style: 'Heading1' }),
  para('Fig. 1 shows a device 10.'),
  para('DETAILED DESCRIPTION', { style: 'Heading1' }),
  para('The device 10 comprises a housing 12.'),
  para('The housing 12 is made of aluminium.'),
  para('CLAIMS', { style: 'Heading1' }),
  para('1. A device (10) comprising a housing (12).'),
  para('2. A device (10) according to claim 1.'),
].join('');
