// ── .docx WRITER (round-trip export) ─────────────────────────────────────────
// Writes edited buffer text back into the ORIGINAL file. Only paragraphs the
// user actually changed are rewritten; every other paragraph, and every other
// part of the ZIP, is preserved byte-for-byte.
//
// The shape of the job: a buffer edit is turned into a list of SPLICES into
// word/document.xml — {xmlStart, xmlEnd, xml} — which are then applied
// back-to-front so earlier offsets stay valid. Three neighbours do the thinking:
//
//   lineDiff.js        which old line became which new line
//   claimNumbering.js  where a claim's number belongs in the exported file
//   xmlText.js         what may legally be written inside a <w:t>
//
// The honest limitation: import flattens runs to plain text, so a rewritten
// paragraph collapses to a single run carrying the first original run's
// formatting. A paragraph with one bold word mid-sentence loses that bold — but
// only if it was edited. Unchanged paragraphs are untouched, and typical
// corrections ("12" → "14", fixing an article) touch a handful of paragraphs.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { blankEdges } from '../blankEdges.ts';
import { DocxError } from './read.ts';
import type { Para, PatentDoc } from './read.ts';
import { alignLines } from './lineDiff.ts';
import { xmlText } from './xmlText.ts';
import {
  NUMPR_RE,
  isClaimLine,
  stripAutoNumber,
  claimListTemplate,
  conformClaim,
} from './claimNumbering.ts';

export { alignLines };

/** One replacement or insertion into document.xml. */
export interface Splice {
  xmlStart: number;
  /** Equal to xmlStart for an insertion. */
  xmlEnd: number;
  xml: string;
  /** True for an insertion — it must be ordered after a replacement at the same offset. */
  append?: boolean;
}

/** One buffer to write back, with the paragraphs it came from. */
export interface WriteBuffer {
  paras: Para[];
  text: string;
  /** Set on the claims buffer so its claim lines keep the section's numbering style. */
  claims?: boolean;
}

/** One section of a freshly generated (never-imported) document. */
export interface NewSection {
  heading?: string;
  text?: string;
}

// ── paragraph XML ────────────────────────────────────────────────────────────

// Word expresses a line break, a tab and the two special hyphens structurally
// rather than as characters, so those characters in the buffer have to become
// elements again. This is the exact inverse of what read.js does for <w:br/>,
// <w:tab/>, <w:noBreakHyphen/> and <w:softHyphen/> — the two sides must stay in
// step, or a paragraph changes shape merely by being edited.
const NBHYPHEN = '\u2011'; // non-breaking hyphen
const SOFTHYPHEN = '\u00AD'; // soft hyphen (invisible — never type it literally)
const SPLIT_RE = /([\n\t\u2011\u00AD])/;
const AS_ELEMENT: Record<string, string | undefined> = {
  '\n': '<w:br/>',
  '\t': '<w:tab/>',
  [NBHYPHEN]: '<w:noBreakHyphen/>',
  [SOFTHYPHEN]: '<w:softHyphen/>',
};

/** Render paragraph text as a single run, mapping the structural characters. */
function runsFor(text: string, rPrXml: string): string {
  let out = '';
  for (const part of String(text).split(SPLIT_RE)) {
    const element = AS_ELEMENT[part];
    if (element) out += element;
    else if (part !== '') out += `<w:t xml:space="preserve">${xmlText(part)}</w:t>`;
  }
  if (!out) out = '<w:t xml:space="preserve"></w:t>';
  return `<w:r>${rPrXml}${out}</w:r>`;
}

/** Rebuild one `<w:p>` around new text, preserving its paragraph properties. */
function buildParagraph(para: Para, text: string): string {
  const { pAttrs, pPrXml, rPrXml } = para.src;
  return `<w:p${pAttrs || ''}>${pPrXml || ''}${runsFor(text, rPrXml || '')}</w:p>`;
}

// w14:paraId / w14:textId must be unique per paragraph, so a clone cannot keep
// the original's — Word uses them to anchor comments and revisions.
const CLONE_DROP_ATTR = /\s+w14:(?:paraId|textId)="[^"]*"/g;

/**
 * The paragraph a newly inserted one should copy its formatting from.
 *
 * Not simply the neighbour: a blank spacer paragraph carries neither the claim
 * indentation nor the `<w:numPr>`, so cloning it drops the new claim to a
 * different alignment from every other claim — and, on an auto-numbered list,
 * leaves it unnumbered.
 */
function templateNear(paras: Para[], i: number): Para | undefined {
  for (let k = Math.min(i, paras.length - 1); k >= 0; k--) {
    const p = paras[k];
    if (p?.text.trim()) return p;
  }
  for (let k = i + 1; k < paras.length; k++) {
    const p = paras[k];
    if (p?.text.trim()) return p;
  }
  return paras[Math.max(0, Math.min(i, paras.length - 1))];
}

/** A brand-new `<w:p>` carrying the surrounding claims' formatting. */
function clonedParagraph(paras: Para[], i: number, line: string, listTpl: Para | null): string {
  // A claim always copies the list, wherever in the section it is being added.
  const tpl = listTpl && isClaimLine(line) ? listTpl : templateNear(paras, i);
  // Only reachable with a non-empty `paras`, which planEdits guarantees.
  if (!tpl) return '';
  const src = { ...tpl.src, pAttrs: (tpl.src.pAttrs || '').replace(CLONE_DROP_ATTR, '') };
  // An empty line is a spacer, and an empty list item would still consume a
  // claim number, so it inherits the formatting but never the numbering.
  if (!line.trim()) src.pPrXml = (src.pPrXml || '').replace(NUMPR_RE, '');
  return buildParagraph({ ...tpl, src }, stripAutoNumber(line, tpl));
}

// ── planning the splices ─────────────────────────────────────────────────────

// A textarea hands back \n, but text pasted from another tool can carry CRLF or
// bare CR. Left alone those would make every line differ from its imported
// counterpart and rewrite the entire document; and a literal CR written into
// <w:t> is normalized back to a line break by any XML parser, so it would not
// survive the trip anyway.
const normalizeNewlines = (s: string): string => String(s).replace(/\r\n?/g, '\n');

/**
 * Work out which paragraphs changed, for one buffer.
 * @param paras      Paragraphs as imported
 * @param editedText Current buffer contents
 * @param opts       `claims` makes every claim line follow the section's own
 *   numbering style (see conformClaim). It is opt-in because only the claims
 *   buffer holds claims: a description line that happens to start with "1." is
 *   prose, not a list item.
 */
export function planEdits(
  paras: Para[],
  editedText: string,
  opts: { claims?: boolean } = {}
): Splice[] {
  if (!paras || !paras.length) return [];
  // Rebuild the line array exactly as the importer assembled the buffer, so the
  // diff lines up with what the user actually saw.
  const oldLines: string[] = [];
  const owner: number[] = []; // line index → paragraph index
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

  const newLines = normalizeNewlines(editedText).split('\n');
  if (visOld.join('\n') === newLines.join('\n')) return [];

  const { map, insertAfter, tail } = alignLines(visOld, newLines);

  // Gather each paragraph's new text from its (possibly re-mapped) lines.
  const byPara = new Map<number, { lines: string[]; deleted: boolean }>();
  /** paragraph index → lines to add as new paragraphs after it */
  const added = new Map<number, string[]>();
  /** paragraph index → its last visible line */
  const lastLineOf = new Map<number, number>();
  visOwner.forEach((pi, li) => lastLineOf.set(pi, li));

  visOwner.forEach((pi, li) => {
    let rec = byPara.get(pi);
    if (!rec) byPara.set(pi, (rec = { lines: [], deleted: true }));
    const to = map[li];
    if (to != null) {
      rec.lines.push(newLines[to] ?? '');
      rec.deleted = false;
    }
    const ins = insertAfter.get(li);
    if (!ins) return;
    if (li === lastLineOf.get(pi)) {
      // A line added after this paragraph is a new paragraph. Folding it in as
      // a <w:br/> instead is what made an inserted claim show up indented and
      // unnumbered: a soft break inside a hanging-indent paragraph renders at
      // the indent, and Word's list numbering only counts paragraphs.
      added.set(pi, [...(added.get(pi) ?? []), ...ins]);
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
  const finalise = (para: Para, line: string): { para: Para; text: string } =>
    opts.claims ? conformClaim(para, line, listTpl) : { para, text: stripAutoNumber(line, para) };

  const splices: Splice[] = [];
  for (const [pi, rec] of byPara) {
    const was = paras[pi];
    if (!was) continue;
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
    const at = paras[pi]?.src.xmlEnd;
    if (at === undefined) continue;
    const xml = lines.map((l) => clonedParagraph(paras, pi, l, listTpl)).join('');
    splices.push({ xmlStart: at, xmlEnd: at, xml, append: true });
  }

  // Lines added past the end follow the last paragraph the user could SEE.
  // Not the last paragraph in the section: toText() trims trailing blank ones,
  // so appending after those puts a blank line between the last claim and the
  // new one that the buffer never showed.
  if (tail.length) {
    const li = (visOwner.length ? visOwner[visOwner.length - 1] : paras.length - 1) ?? 0;
    const at = paras[li]?.src.xmlEnd;
    if (at !== undefined) {
      const xml = tail.map((l) => clonedParagraph(paras, li, l, listTpl)).join('');
      splices.push({ xmlStart: at, xmlEnd: at, xml, append: true });
    }
  }
  return splices;
}

// ── applying the splices ─────────────────────────────────────────────────────

/**
 * Order splices for back-to-front application, and refuse to apply a set that
 * would corrupt the document.
 *
 * Two rules, and the second one was a real defect. At the SAME offset an
 * insertion and a replacement can meet: a line inserted after paragraph P lands
 * at P's xmlEnd, which is exactly the xmlStart of paragraph P+1, and P+1 may
 * have been edited too. Applying the insertion first leaves the replacement's
 * range pointing at the text just inserted, so it eats the new paragraph and
 * cuts the next one in half — what comes out is not well-formed XML at all and
 * Word refuses to open it. The replacement has to go first; the insertion then
 * lands cleanly in front of it.
 *
 * Anything still overlapping after that is a bug upstream (most likely two
 * buffers claiming the same paragraphs — see the section clipping in
 * docSplit.js), and a silently mangled patent application is far worse than a
 * failed export, so it throws.
 *
 * @param xmlLength Length of the document the offsets refer to
 * @throws {DocxError} code 'spliceOverlap'
 */
export function orderSplices(splices: Splice[], xmlLength: number): Splice[] {
  const ordered = [...splices].sort(
    // Descending by offset, and at equal offsets replacements before insertions.
    // Written as a subtraction so the comparator is a total order — a
    // `? -1 : 1` form is not, and sort may then do anything it likes with it.
    (x, y) => y.xmlStart - x.xmlStart || (x.append ? 1 : 0) - (y.append ? 1 : 0)
  );
  let lowestTouched = xmlLength;
  for (const s of ordered) {
    if (s.xmlStart < 0 || s.xmlEnd < s.xmlStart || s.xmlEnd > xmlLength)
      throw new DocxError('spliceOverlap');
    // Ranges are visited in descending order, so each must end at or before the
    // lowest offset any splice later in the document reached. An insertion
    // (start === end) sitting exactly on that boundary is fine — it is a point,
    // not a range, and the ordering above already puts it after the replacement
    // it shares the offset with.
    if (s.xmlEnd > lowestTouched) throw new DocxError('spliceOverlap');
    lowestTouched = Math.min(lowestTouched, s.xmlStart);
  }
  return ordered;
}

/** Apply ordered splices to document.xml. */
function applySplices(xml: string, splices: Splice[]): string {
  let out = xml;
  for (const s of orderSplices(splices, xml.length))
    out = out.slice(0, s.xmlStart) + s.xml + out.slice(s.xmlEnd);
  return out;
}

/**
 * Produce an edited .docx.
 * @returns the new file
 * @throws {DocxError} code 'spliceOverlap' rather than emitting a broken file
 */
export function writeDocx(doc: PatentDoc, buffers: WriteBuffer[]): Uint8Array {
  const splices: Splice[] = [];
  for (const b of buffers) splices.push(...planEdits(b.paras, b.text, { claims: b.claims }));

  const xml = applySplices(doc.documentXml, splices);
  const entries = unzipSync(doc.bytes);
  entries['word/document.xml'] = strToU8(xml);
  return zipSync(entries, { level: 6 });
}

/** Build a minimal .docx from plain text, for buffers that were never imported. */
export function createDocx(sections: NewSection[]): Uint8Array {
  const body = sections
    .map((sec) => {
      const head = sec.heading
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runsFor(sec.heading, '')}</w:p>`
        : '';
      const paras = normalizeNewlines(sec.text || '')
        .split('\n')
        .map((l) => `<w:p>${runsFor(l, '')}</w:p>`)
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
export function documentXmlOf(bytes: Uint8Array): string {
  const part = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })[
    'word/document.xml'
  ];
  if (!part) throw new DocxError('noDocument');
  return strFromU8(part);
}
