// ── .docx WRITER (round-trip export) ─────────────────────────────────────────
// Writes edited buffer text back into the ORIGINAL file. Only paragraphs the
// user actually changed are rewritten; every other paragraph, and every other
// part of the ZIP, is preserved byte-for-byte.
//
// The honest limitation: import flattens runs to plain text, so a rewritten
// paragraph collapses to a single run carrying the first original run's
// formatting. A paragraph with one bold word mid-sentence loses that bold — but
// only if it was edited. Unchanged paragraphs are untouched, and typical
// corrections ("12" → "14", fixing an article) touch a handful of paragraphs.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Longest common subsequence of two line arrays → aligned index pairs. */
function lcsPairs(a, b) {
  const n = a.length,
    m = b.length;
  const pairs = [];
  if (!n || !m) return pairs;
  // Bounded: past this size the prefix/suffix trim below has already failed to
  // reduce the problem, and a positional pairing is good enough.
  if (n * m > 4_000_000) return pairs;
  const dp = new Int32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Align old lines to new lines.
 * @returns {{map: (number|null)[], insertAfter: Map<number, string[]>, tail: string[]}}
 *   map[i] = index in `b` that old line i became, or null if the line was deleted.
 *   insertAfter: brand-new lines that follow old line i.
 *   tail: brand-new lines after the very last old line.
 */
export function alignLines(a, b) {
  const map = new Array(a.length).fill(null);
  const insertAfter = new Map();
  // Trim the common head and tail first; in practice this leaves a tiny middle.
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) {
    map[lo] = lo;
    lo++;
  }
  let hi = 0;
  while (
    hi < a.length - lo &&
    hi < b.length - lo &&
    a[a.length - 1 - hi] === b[b.length - 1 - hi]
  ) {
    map[a.length - 1 - hi] = b.length - 1 - hi;
    hi++;
  }
  const aMid = a.slice(lo, a.length - hi);
  const bMid = b.slice(lo, b.length - hi);
  if (!aMid.length && !bMid.length) return { map, insertAfter, tail: [] };

  const anchors = lcsPairs(aMid, bMid).map(([i, j]) => [i + lo, j + lo]);
  // Walk anchor to anchor, pairing the lines in between positionally.
  const blocks = [];
  let pi = lo,
    pj = lo;
  for (const [ai, bj] of anchors) {
    blocks.push([pi, ai, pj, bj]);
    map[ai] = bj;
    pi = ai + 1;
    pj = bj + 1;
  }
  blocks.push([pi, a.length - hi, pj, b.length - hi]);

  const tail = [];
  for (const [a0, a1, b0, b1] of blocks) {
    const oldN = a1 - a0,
      newN = b1 - b0;
    const paired = Math.min(oldN, newN);
    for (let k = 0; k < paired; k++) map[a0 + k] = b0 + k;
    // Surplus old lines were deleted (map stays null).
    // Surplus new lines are insertions; attach them to the last old line in the
    // block, or to the tail when the block sits at the very end.
    if (newN > oldN) {
      const extra = [];
      for (let k = paired; k < newN; k++) extra.push(b[b0 + k]);
      const anchorLine = a0 + paired - 1 >= 0 ? a0 + paired - 1 : a0 - 1;
      if (anchorLine < 0 || a1 >= a.length) tail.push(...extra);
      else insertAfter.set(anchorLine, [...(insertAfter.get(anchorLine) || []), ...extra]);
    }
  }
  return { map, insertAfter, tail };
}

/** Render paragraph text as runs, mapping \n → <w:br/> and \t → <w:tab/>. */
function runsFor(text, rPrXml) {
  const parts = String(text).split(/([\n\t])/);
  let out = '';
  for (const part of parts) {
    if (part === '\n') out += '<w:br/>';
    else if (part === '\t') out += '<w:tab/>';
    else if (part !== '') out += `<w:t xml:space="preserve">${esc(part)}</w:t>`;
  }
  if (!out) out = '<w:t xml:space="preserve"></w:t>';
  return `<w:r>${rPrXml}${out}</w:r>`;
}

/** Rebuild one `<w:p>` around new text, preserving its paragraph properties. */
function buildParagraph(para, text) {
  const { pAttrs, pPrXml, rPrXml } = para.src;
  return `<w:p${pAttrs || ''}>${pPrXml || ''}${runsFor(text, rPrXml || '')}</w:p>`;
}

/**
 * Work out which paragraphs changed, for one buffer.
 * @param {import('./read.js').Para[]} paras Paragraphs as imported
 * @param {string} editedText                Current buffer contents
 * @returns {{xmlStart:number, xmlEnd:number, xml:string}[]} splices into document.xml
 */
export function planEdits(paras, editedText) {
  if (!paras || !paras.length) return [];
  // Rebuild the line array exactly as the importer assembled the buffer, so the
  // diff lines up with what the user actually saw.
  const oldLines = [];
  const owner = []; // line index → paragraph index
  paras.forEach((p, pi) => {
    const ls = p.text.split('\n');
    for (const l of ls) {
      oldLines.push(l);
      owner.push(pi);
    }
  });
  // toText() trimmed leading/trailing blank lines; mirror that here.
  let head = 0;
  while (head < oldLines.length && !oldLines[head].trim()) head++;
  let tailBlank = 0;
  while (tailBlank < oldLines.length - head && !oldLines[oldLines.length - 1 - tailBlank].trim())
    tailBlank++;
  const visOld = oldLines.slice(head, oldLines.length - tailBlank);
  const visOwner = owner.slice(head, oldLines.length - tailBlank);

  const newLines = String(editedText).split('\n');
  if (visOld.join('\n') === newLines.join('\n')) return [];

  const { map, insertAfter, tail } = alignLines(visOld, newLines);

  // Gather each paragraph's new text from its (possibly re-mapped) lines.
  const byPara = new Map();
  visOwner.forEach((pi, li) => {
    if (!byPara.has(pi)) byPara.set(pi, { lines: [], deleted: true });
    const rec = byPara.get(pi);
    if (map[li] != null) {
      rec.lines.push(newLines[map[li]]);
      rec.deleted = false;
    }
    const ins = insertAfter.get(li);
    if (ins) {
      rec.lines.push(...ins);
      rec.deleted = false;
    }
  });

  const splices = [];
  for (const [pi, rec] of byPara) {
    const para = paras[pi];
    let next = rec.lines.join('\n');
    // Never write our synthesized claim numbers back — the paragraph already
    // carries <w:numPr> and Word would render "1. 1. A device…".
    const prefix = para.src.synthesizedPrefix;
    const wasText =
      prefix && para.text.startsWith(prefix) ? para.text.slice(prefix.length) : para.text;
    if (prefix && next.startsWith(prefix)) next = next.slice(prefix.length);
    if (rec.deleted) {
      splices.push({ xmlStart: para.src.xmlStart, xmlEnd: para.src.xmlEnd, xml: '' });
    } else if (next !== wasText) {
      splices.push({
        xmlStart: para.src.xmlStart,
        xmlEnd: para.src.xmlEnd,
        xml: buildParagraph(para, next),
      });
    }
  }

  // Lines added past the end become new paragraphs cloned from the last one.
  if (tail.length) {
    const last = paras[paras.length - 1];
    const xml = tail.map((l) => buildParagraph(last, l)).join('');
    splices.push({ xmlStart: last.src.xmlEnd, xmlEnd: last.src.xmlEnd, xml, append: true });
  }
  return splices;
}

/**
 * Produce an edited .docx.
 * @param {import('./read.js').PatentDoc} doc  The imported document
 * @param {{paras: import('./read.js').Para[], text: string}[]} buffers
 * @returns {Uint8Array} the new file
 */
export function writeDocx(doc, buffers) {
  const splices = [];
  for (const b of buffers) splices.push(...planEdits(b.paras, b.text));
  // Apply back-to-front so earlier offsets stay valid. Appends sort after
  // replacements at the same offset.
  splices.sort((x, y) => y.xmlStart - x.xmlStart || (x.append ? -1 : 1));

  let xml = doc.documentXml;
  for (const s of splices) xml = xml.slice(0, s.xmlStart) + s.xml + xml.slice(s.xmlEnd);

  const entries = unzipSync(doc.bytes);
  entries['word/document.xml'] = strToU8(xml);
  return zipSync(entries, { level: 6 });
}

/** Build a minimal .docx from plain text, for buffers that were never imported. */
export function createDocx(sections) {
  const body = sections
    .map((sec) => {
      const head = sec.heading
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${esc(sec.heading)}</w:t></w:r></w:p>`
        : '';
      const paras = String(sec.text || '')
        .split('\n')
        .map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`)
        .join('');
      return head + paras;
    })
    .join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      'word/document.xml': strToU8(documentXml),
    },
    { level: 6 }
  );
}

/** Read back document.xml from a produced file — used by the tests. */
export function documentXmlOf(bytes) {
  return strFromU8(
    unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml']
  );
}
