// ── IMPORT / EXPORT ORCHESTRATION ────────────────────────────────────────────
// Thin, format-agnostic seam between the UI and the readers/writers. Keeping it
// here (rather than in App.jsx) means the whole import pipeline stays testable
// under the node environment.

import { readDocx, DocxError } from './docx/read.js';
import { writeDocx, createDocx } from './docx/write.js';
import { splitPatentDoc, refListWritable } from './docSplit.js';
import { detectLang } from './detectLang.js';
import { fileKind } from './fileKind.js';

// Re-exported so this module stays the single seam callers reason about, even
// though the implementation lives elsewhere to keep it out of the lazy chunk.
export { fileKind };

/**
 * @typedef {Object} ImportResult
 * @property {import('./docx/read.js').PatentDoc} doc
 * @property {import('./docSplit.js').SplitResult} split
 * @property {'en'|'de'} lang
 * @property {'headings'|'text'} langFrom
 */

/**
 * Read a .docx into buffers.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {ImportResult}
 * @throws {DocxError}
 */
export function importPatentDoc(buf) {
  const doc = readDocx(buf);
  const split = splitPatentDoc(doc);
  const { lang, from } = detectLang(split, `${split.description}\n${split.claims}`);
  return { doc, split, lang, langFrom: from };
}

/**
 * Produce the bytes for an export.
 *
 * With provenance (the buffers came from an import) this rewrites the original
 * file, touching only changed paragraphs. Without it there is no source document
 * to write into, so a fresh minimal .docx is generated instead — the caller is
 * expected to tell the user which of the two it is getting.
 *
 * The reference-sign list is written back too, but only when the source marks
 * it out unambiguously — see refListWritable. When it does not, the other
 * buffers still export and `refList` reports why the list was left alone, so
 * the caller can say so rather than let the user believe an edit was saved.
 *
 * @param {ImportResult|null} imported
 * @param {{description: string, claims: string, refList?: string}} buffers
 * @param {{claimsHeading?: string, refListHeading?: string}} [opts]
 * @returns {{bytes: Uint8Array, mode: 'roundTrip'|'fresh',
 *            refList: 'written'|'unchanged'|'noSection'|'ambiguous'|'table'}}
 */
export function exportPatentDoc(imported, buffers, opts = {}) {
  const refList = buffers.refList || '';
  if (imported?.doc) {
    const write = [
      { paras: imported.split.descParas, text: buffers.description },
      { paras: imported.split.claimsParas, text: buffers.claims, claims: true },
    ];
    const can = refListWritable(imported.split);
    // An untouched list is not a failure to report — it is simply nothing to do,
    // and planEdits would produce no splices for it anyway.
    const unchanged = refList === imported.split.signList;
    if (can.ok && !unchanged) write.push({ paras: imported.split.signListParas, text: refList });
    return {
      bytes: writeDocx(imported.doc, write),
      mode: 'roundTrip',
      refList: can.ok ? (unchanged ? 'unchanged' : 'written') : can.reason,
    };
  }
  const sections = [];
  if (buffers.description) sections.push({ text: buffers.description });
  if (buffers.claims)
    sections.push({ heading: opts.claimsHeading || 'Claims', text: buffers.claims });
  // Nothing to damage in a file we are building from scratch, so the list is
  // always included when there is one.
  if (refList.trim())
    sections.push({ heading: opts.refListHeading || 'Reference signs', text: refList });
  return {
    bytes: createDocx(sections),
    mode: 'fresh',
    refList: refList.trim() ? 'written' : 'unchanged',
  };
}

export { DocxError };
