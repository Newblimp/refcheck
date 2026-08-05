// ── .docx READER ─────────────────────────────────────────────────────────────
// The ONLY module that knows OOXML exists. It turns a .docx into the shared
// document model (see typedefs below); everything downstream — the splitter, the
// language detector, the UI — is format-agnostic, so a future .odt/.rtf importer
// is one new adapter here and nothing else.
//
// What is deliberately NOT read:
//   • headers/footers/comments/footnotes — separate ZIP parts, so reading only
//     word/document.xml excludes them for free
//   • text boxes (<w:txbxContent>) — these ARE inline in document.xml, so they
//     are skipped explicitly
//   • deleted text (<w:delText>) — tracked-change deletions; insertions live in
//     ordinary <w:t> and are kept, giving an "all changes accepted" view
//
// Parsing is a hand-rolled tag scanner rather than DOMParser: the logic tests run
// under the fast `node` environment (vite.config.js), which has no DOM, and the
// subset of OOXML we care about is tiny.

import { unzipSync, strFromU8 } from 'fflate';

/**
 * @typedef {Object} ParaSrc  Provenance handle. Written here, read only by
 *   ../docx/write.js — the splitter and UI never look inside it.
 * @property {number} xmlStart   Offset of `<w:p …>` in document.xml
 * @property {number} xmlEnd     Offset just past `</w:p>`
 * @property {string} pPrXml     The paragraph's `<w:pPr>…</w:pPr>`, or ''
 * @property {string} rPrXml     First run's `<w:rPr>…</w:rPr>`, or ''
 * @property {string} pAttrs     Attributes on the `<w:p>` tag
 * @property {string} synthesizedPrefix  Claim number we injected, or ''
 */

/**
 * @typedef {Object} Para
 * @property {string} text       Flattened paragraph text (no trailing newline)
 * @property {string} style      w:pStyle value, e.g. 'Heading1' ('' if none)
 * @property {boolean} numbered  Carries <w:numPr> (Word auto-numbering)
 * @property {number|null} numId Auto-numbering list id
 * @property {number} ilvl       Auto-numbering level
 * @property {boolean} bold      Every run in the paragraph is bold
 * @property {ParaSrc} src
 */

/**
 * @typedef {Object} PatentDoc
 * @property {Para[]} paragraphs
 * @property {string} documentXml  Raw word/document.xml (export splices into it)
 * @property {Uint8Array} bytes    The original file, for round-trip export
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the XML entities Word actually emits. */
export function decodeXml(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
  });
}

const attr = (attrs, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

// Matches one XML tag: name, attributes, self-closing flag.
const TAG_RE = /<(\/?)([A-Za-z0-9:_.-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * Parse word/document.xml into the paragraph model. Pure — no DOM, no zip.
 * @param {string} xml
 * @returns {Para[]}
 */
export function docxXmlToParagraphs(xml) {
  const paras = [];
  let p = null; // paragraph under construction
  let chunks = null; // text pieces of the current paragraph
  let skipDepth = 0; // inside <w:txbxContent> / <w:del> → ignore content
  let skipTag = null; // which tag opened the skip
  let inT = false; // inside <w:t>
  let tStart = 0; // where the current <w:t> body began
  let inPPr = 0; // inside <w:pPr> (paragraph-level props)
  let pPrStart = -1;
  let runDepth = 0; // inside <w:r>
  let rPrStart = -1;
  let runCount = 0,
    boldRuns = 0,
    curRunBold = false;

  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(xml)) !== null) {
    const [full, close, name, attrs, selfClose] = m;
    const isClose = close === '/';
    const isSelf = selfClose === '/';

    // ── skipped subtrees ────────────────────────────────────────────────────
    if (skipDepth > 0) {
      if (name === skipTag) {
        if (isClose) skipDepth--;
        else if (!isSelf) skipDepth++;
        if (skipDepth === 0) skipTag = null;
      }
      continue;
    }
    if (!isClose && !isSelf && (name === 'w:txbxContent' || name === 'w:del')) {
      skipDepth = 1;
      skipTag = name;
      continue;
    }

    switch (name) {
      case 'w:p': {
        if (isSelf) {
          // <w:p/> — an empty paragraph still occupies a line
          paras.push(
            makePara('', '', false, null, 0, false, {
              xmlStart: m.index,
              xmlEnd: m.index + full.length,
              pPrXml: '',
              rPrXml: '',
              pAttrs: attrs,
              synthesizedPrefix: '',
            })
          );
          break;
        }
        if (isClose) {
          if (p) {
            p.text = chunks.join('');
            p.bold = runCount > 0 && boldRuns === runCount;
            p.src.xmlEnd = m.index + full.length;
            paras.push(p);
          }
          p = null;
          chunks = null;
          pPrStart = -1;
          runCount = 0;
          boldRuns = 0;
        } else {
          p = makePara('', '', false, null, 0, false, {
            xmlStart: m.index,
            xmlEnd: -1,
            pPrXml: '',
            rPrXml: '',
            pAttrs: attrs,
            synthesizedPrefix: '',
          });
          chunks = [];
          runCount = 0;
          boldRuns = 0;
          pPrStart = -1;
        }
        break;
      }
      case 'w:pPr':
        if (isClose) {
          inPPr--;
          if (p && pPrStart >= 0) p.src.pPrXml = xml.slice(pPrStart, m.index + full.length);
        } else if (!isSelf) {
          inPPr++;
          if (pPrStart < 0) pPrStart = m.index;
        }
        break;
      case 'w:pStyle':
        if (p && inPPr > 0) p.style = attr(attrs, 'w:val') || '';
        break;
      case 'w:numPr':
        if (p && inPPr > 0 && !isClose) p.numbered = true;
        break;
      case 'w:numId':
        if (p && inPPr > 0) {
          const v = attr(attrs, 'w:val');
          if (v != null) p.numId = Number(v);
        }
        break;
      case 'w:ilvl':
        if (p && inPPr > 0) {
          const v = attr(attrs, 'w:val');
          if (v != null) p.ilvl = Number(v);
        }
        break;
      case 'w:r':
        if (isClose) {
          runDepth--;
          if (curRunBold) boldRuns++;
          curRunBold = false;
        } else if (!isSelf) {
          runDepth++;
          runCount++;
          curRunBold = false;
        }
        break;
      case 'w:rPr':
        // Remember the FIRST run's formatting; export reuses it when a
        // paragraph has to be rebuilt.
        if (!isClose && !isSelf && runDepth > 0 && p && !p.src.rPrXml) rPrStart = m.index;
        else if (isClose && rPrStart >= 0 && p && !p.src.rPrXml) {
          p.src.rPrXml = xml.slice(rPrStart, m.index + full.length);
          rPrStart = -1;
        }
        break;
      case 'w:b':
        if (runDepth > 0 && !isClose) {
          // <w:b w:val="0"/> switches bold OFF
          const v = attr(attrs, 'w:val');
          curRunBold = v !== '0' && v !== 'false';
        }
        break;
      case 'w:t':
        if (isSelf) break;
        if (isClose) {
          if (inT && chunks) chunks.push(decodeXml(xml.slice(tStart, m.index)));
          inT = false;
        } else {
          inT = true;
          tStart = m.index + full.length;
        }
        break;
      case 'w:tab':
        if (chunks && runDepth > 0) chunks.push('\t');
        break;
      case 'w:br':
      case 'w:cr':
        if (chunks) chunks.push('\n');
        break;
      default:
        break;
    }
  }
  return paras;
}

function makePara(text, style, numbered, numId, ilvl, bold, src) {
  return { text, style, numbered, numId, ilvl, bold, src };
}

/** True for the Office Open XML magic bytes (a ZIP local file header). */
const isZip = (b) =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);

export class DocxError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Read a .docx/.docm into the document model.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {PatentDoc}
 * @throws {DocxError} code 'notZip' (legacy .doc / not a Word file) or
 *   'noDocument' (a zip, but not a Word document)
 */
export function readDocx(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!isZip(bytes)) throw new DocxError('notZip');
  let entries;
  try {
    entries = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new DocxError('notZip');
  }
  const doc = entries['word/document.xml'];
  if (!doc) throw new DocxError('noDocument');
  const documentXml = strFromU8(doc);
  return { paragraphs: docxXmlToParagraphs(documentXml), documentXml, bytes };
}
