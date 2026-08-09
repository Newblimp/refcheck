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
import { escapeMarkup } from '../escape.js';
import { blankEdges } from '../blankEdges.js';
import { DocxError } from './read.js';

// Shared with the HTML backdrop builder — same three characters, same rules.
const esc = escapeMarkup;

/** Longest common subsequence of two line arrays → aligned index pairs. */
// Cell budget for the LCS table. Beyond this the diff falls back to positional
// pairing: a 2000x2000 table is already 16MB and 4M iterations, which is not a
// reasonable thing to do in a browser tab for a cosmetic alignment improvement.
const MAX_LCS_CELLS = 4_000_000;

function lcsPairs(a, b) {
  const n = a.length,
    m = b.length;
  const pairs = [];
  if (!n || !m) return pairs;
  // Bounded: past this size the prefix/suffix trim below has already failed to
  // reduce the problem, and a positional pairing is good enough.
  if (n * m > MAX_LCS_CELLS) return pairs;
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
  const isBlank = (s) => !s.trim();
  // `at` is the first old line not yet consumed, so the new line belongs after
  // old line at-1. With no old line before it, or none left after it anywhere,
  // it belongs to the tail.
  const addInsert = (line, at) => {
    const anchor = at - 1;
    if (anchor < 0 || at >= a.length) tail.push(line);
    else insertAfter.set(anchor, [...(insertAfter.get(anchor) || []), line]);
  };

  for (const [a0, a1, b0, b1] of blocks) {
    let ai = a0,
      bj = b0;
    // Pair line for line, but never pair a blank line with a real one. A spacer
    // paragraph between claims carries none of a claim's numbering or
    // indentation, so writing claim text into it strands that claim at a
    // different alignment from the rest — and deletes the paragraph that had
    // the right formatting.
    while (ai < a1 && bj < b1) {
      if (isBlank(a[ai]) === isBlank(b[bj])) {
        map[ai] = bj;
        ai++;
        bj++;
      } else if (isBlank(a[ai])) {
        ai++; // the edit removed a spacer
      } else {
        addInsert(b[bj++], ai); // the edit added a spacer
      }
    }
    // Surplus new lines are insertions; surplus old lines stay null (deleted).
    while (bj < b1) addInsert(b[bj++], ai);
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

// A leading claim number, in the same shape isClaimNumber() recognises.
const AUTO_NUM_RE = /^\s*\d{1,4}\s*[.)]\s*/;
const NUMPR_RE = /<w:numPr\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:numPr>)/g;
// w14:paraId / w14:textId must be unique per paragraph, so a clone cannot keep
// the original's — Word uses them to anchor comments and revisions.
const CLONE_DROP_ATTR = /\s+w14:(?:paraId|textId)="[^"]*"/g;

/**
 * Text to write into a paragraph whose number comes from Word's list numbering.
 *
 * The import synthesizes "N. " for auto-numbered claims (they carry no number
 * in the text at all), and writing that back would make Word render "1. 1. A
 * device…". Stripping the *recorded* prefix is not enough: an edit that inserts
 * a claim renumbers the ones below it, so the paragraph whose prefix was "2. "
 * now reads "3. …" and the literal number survives. A synthesized prefix is
 * proof that the numbering is Word's, so any leading claim number goes.
 */
function stripAutoNumber(text, para) {
  return para.src.synthesizedPrefix ? String(text).replace(AUTO_NUM_RE, '') : text;
}

/**
 * The paragraph a newly inserted one should copy its formatting from.
 *
 * Not simply the neighbour: a blank spacer paragraph carries neither the claim
 * indentation nor the `<w:numPr>`, so cloning it drops the new claim to a
 * different alignment from every other claim — and, on an auto-numbered list,
 * leaves it unnumbered.
 */
function templateNear(paras, i) {
  for (let k = Math.min(i, paras.length - 1); k >= 0; k--)
    if (paras[k].text.trim()) return paras[k];
  for (let k = i + 1; k < paras.length; k++) if (paras[k].text.trim()) return paras[k];
  return paras[Math.max(0, Math.min(i, paras.length - 1))];
}

/** A brand-new `<w:p>` carrying the surrounding claims' formatting. */
function clonedParagraph(paras, i, line, listTpl) {
  // A claim always copies the list, wherever in the section it is being added.
  const tpl = listTpl && AUTO_NUM_RE.test(line) ? listTpl : templateNear(paras, i);
  const src = { ...tpl.src, pAttrs: (tpl.src.pAttrs || '').replace(CLONE_DROP_ATTR, '') };
  // An empty line is a spacer, and an empty list item would still consume a
  // claim number, so it inherits the formatting but never the numbering.
  if (!line.trim()) src.pPrXml = (src.pPrXml || '').replace(NUMPR_RE, '');
  return buildParagraph({ ...tpl, src }, stripAutoNumber(line, tpl));
}

/**
 * The claim paragraph that shows how this section numbers its claims, or null
 * when the numbers are typed into the text.
 *
 * A synthesized prefix is the marker: the import injects one exactly when Word
 * numbers the paragraph itself (single-level decimal `<w:numPr>`), so its
 * presence proves the section is a Word list rather than typed "1. " text.
 */
function claimListTemplate(paras) {
  return paras.find((p) => p.numbered && p.ilvl === 0 && p.src.synthesizedPrefix) || null;
}

/**
 * Put a claim line in a paragraph that numbers claims the way the rest of the
 * section does.
 *
 * Paragraph identity is positional, so a claim line can land in a paragraph
 * that was never a claim — the plain paragraph after the last list item, or a
 * "What is claimed is:" lead-in — and it used to keep whatever that paragraph
 * was. The result was a claim set half in Word's list and half as typed text.
 * Which paragraph a line lands in is an artefact of the diff; how the section
 * numbers claims is not, so the section wins.
 *
 * Only lines that open with a claim number are touched, which is what leaves a
 * lead-in line alone: it is not a claim, so it must not join the list and take
 * a number of its own.
 */
function conformClaim(para, line, listTpl) {
  // Multi-level numbering is the case docSplit refuses to guess at (it
  // synthesizes no number and flags `unusualNumbering`); guessing here instead
  // would be no better informed.
  if (para.ilvl > 0 || !AUTO_NUM_RE.test(line)) return { para, text: stripAutoNumber(line, para) };

  if (listTpl) {
    // Word supplies the number, so the paragraph must be a list item and the
    // typed number must go.
    const src = {
      ...para.src,
      pPrXml: listTpl.src.pPrXml,
      synthesizedPrefix: listTpl.src.synthesizedPrefix,
    };
    return { para: { ...para, src, numbered: true }, text: line.replace(AUTO_NUM_RE, '') };
  }
  // The number is part of the text, so nothing may carry list numbering that
  // would add a second one in front of it.
  if (!para.numbered) return { para, text: line };
  const src = {
    ...para.src,
    pPrXml: (para.src.pPrXml || '').replace(NUMPR_RE, ''),
    synthesizedPrefix: '',
  };
  return { para: { ...para, src, numbered: false }, text: line };
}

/**
 * Work out which paragraphs changed, for one buffer.
 * @param {import('./read.js').Para[]} paras Paragraphs as imported
 * @param {string} editedText                Current buffer contents
 * @param {{claims?: boolean}} [opts]        `claims` makes every claim line
 *   follow the section's own numbering style (see conformClaim). It is opt-in
 *   because only the claims buffer holds claims: a description line that
 *   happens to start with "1." is prose, not a list item.
 * @returns {{xmlStart:number, xmlEnd:number, xml:string}[]} splices into document.xml
 */
export function planEdits(paras, editedText, opts = {}) {
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
  // toText() trimmed leading/trailing blank lines; the same rule has to apply
  // here or the diff lines up against text the user never saw.
  const { head, tail: tailBlank } = blankEdges(oldLines);
  const visOld = oldLines.slice(head, oldLines.length - tailBlank);
  const visOwner = owner.slice(head, oldLines.length - tailBlank);

  const newLines = String(editedText).split('\n');
  if (visOld.join('\n') === newLines.join('\n')) return [];

  const { map, insertAfter, tail } = alignLines(visOld, newLines);

  // Gather each paragraph's new text from its (possibly re-mapped) lines.
  const byPara = new Map();
  const added = new Map(); // paragraph index → lines to add as new paragraphs after it
  const lastLineOf = new Map(); // paragraph index → its last visible line
  visOwner.forEach((pi, li) => lastLineOf.set(pi, li));

  visOwner.forEach((pi, li) => {
    if (!byPara.has(pi)) byPara.set(pi, { lines: [], deleted: true });
    const rec = byPara.get(pi);
    if (map[li] != null) {
      rec.lines.push(newLines[map[li]]);
      rec.deleted = false;
    }
    const ins = insertAfter.get(li);
    if (!ins) return;
    if (li === lastLineOf.get(pi)) {
      // A line added after this paragraph is a new paragraph. Folding it in as
      // a <w:br/> instead is what made an inserted claim show up indented and
      // unnumbered: a soft break inside a hanging-indent paragraph renders at
      // the indent, and Word's list numbering only counts paragraphs.
      added.set(pi, [...(added.get(pi) || []), ...ins]);
    } else {
      // ...but a line added between two lines of ONE paragraph (a paragraph
      // holding <w:br/>s of its own) really does belong inside it.
      rec.lines.push(...ins);
      rec.deleted = false;
    }
  });

  // How this section numbers its claims — Word's list, or numbers typed into
  // the text. Every claim line written below is made to match it.
  const listTpl = opts.claims ? claimListTemplate(paras) : null;
  // Never write our synthesized claim numbers back — the paragraph already
  // carries <w:numPr> and Word would render "1. 1. A device…".
  const finalise = (para, line) =>
    opts.claims ? conformClaim(para, line, listTpl) : { para, text: stripAutoNumber(line, para) };

  const splices = [];
  for (const [pi, rec] of byPara) {
    const was = paras[pi];
    const { para, text: next } = finalise(was, rec.lines.join('\n'));
    const wasText = stripAutoNumber(was.text, was);
    // A paragraph also has to be rewritten when only its numbering changed —
    // the claim text can be identical and still be sitting in the wrong kind
    // of paragraph.
    const reshaped = (para.src.pPrXml || '') !== (was.src.pPrXml || '');
    if (rec.deleted) {
      splices.push({ xmlStart: was.src.xmlStart, xmlEnd: was.src.xmlEnd, xml: '' });
    } else if (next !== wasText || reshaped) {
      splices.push({
        xmlStart: was.src.xmlStart,
        xmlEnd: was.src.xmlEnd,
        xml: buildParagraph(para, next),
      });
    }
  }

  // Lines added mid-buffer become new paragraphs after the one they follow.
  for (const [pi, lines] of added) {
    const at = paras[pi].src.xmlEnd;
    const xml = lines.map((l) => clonedParagraph(paras, pi, l, listTpl)).join('');
    splices.push({ xmlStart: at, xmlEnd: at, xml, append: true });
  }

  // Lines added past the end follow the last paragraph the user could SEE.
  // Not the last paragraph in the section: toText() trims trailing blank ones,
  // so appending after those puts a blank line between the last claim and the
  // new one that the buffer never showed.
  if (tail.length) {
    const li = visOwner.length ? visOwner[visOwner.length - 1] : paras.length - 1;
    const at = paras[li].src.xmlEnd;
    const xml = tail.map((l) => clonedParagraph(paras, li, l, listTpl)).join('');
    splices.push({ xmlStart: at, xmlEnd: at, xml, append: true });
  }
  return splices;
}

/**
 * Refuse to apply two edits to the same bytes.
 *
 * Each buffer plans its splices from its own paragraphs, so nothing checks
 * across buffers — and the splitter CAN hand back overlapping regions: with no
 * detailed-description heading it falls back to "everything before the claims"
 * as the description, which swallows a reference-sign list placed before them.
 * Two sets of splices over one range do not merge, they interleave, and the
 * result is a .docx Word cannot open. A loud failure is the only acceptable
 * outcome; the caller decides which buffer to drop (see refListWritable).
 *
 * @param {{xmlStart:number, xmlEnd:number}[]} sorted  Splices, descending by start
 */
function assertDisjoint(sorted) {
  // Walking from the end of the document backwards, nothing may reach past the
  // leftmost edit seen so far. An append is zero-width ([x, x)), so it touches
  // its neighbours without overlapping them — which `>` gets right and `>=`
  // would not: inserting a paragraph directly before an edited one is ordinary.
  let minStart = Infinity;
  for (const s of sorted) {
    if (s.xmlEnd > minStart) throw new DocxError('overlappingEdits');
    minStart = Math.min(minStart, s.xmlStart);
  }
}

/**
 * Produce an edited .docx.
 * @param {import('./read.js').PatentDoc} doc  The imported document
 * @param {{paras: import('./read.js').Para[], text: string, claims?: boolean}[]} buffers
 *   Mark the claims buffer with `claims: true` so its claim lines keep the
 *   section's numbering style.
 * @returns {Uint8Array} the new file
 */
export function writeDocx(doc, buffers) {
  const splices = [];
  for (const b of buffers) splices.push(...planEdits(b.paras, b.text, { claims: b.claims }));
  // Apply back-to-front so earlier offsets stay valid. Appends sort after
  // replacements at the same offset.
  splices.sort((x, y) => y.xmlStart - x.xmlStart || (x.append ? -1 : 1));
  assertDisjoint(splices);

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
