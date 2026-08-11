// ── IMPORT / EXPORT ORCHESTRATION ────────────────────────────────────────────
// Thin, format-agnostic seam between the UI and the readers/writers. Keeping it
// here (rather than in App.jsx) means the whole import pipeline stays testable
// under the node environment.

import { readDocx, DocxError } from './docx/read.js';
import { writeDocx, createDocx } from './docx/write.js';
import { verifyExport } from './docx/verify.js';
import { splitPatentDoc, refListWritable } from './docSplit.js';
import { detectLang } from './detectLang.ts';
import { fileKind } from './fileKind.ts';

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
 * A round-trip export is VERIFIED before it is handed back: the bytes are read
 * again and compared with the buffers (see docx/verify.js). The file is still
 * returned when they disagree — refusing to export would leave a drafter with
 * no way to get their work out — but `verified` is false and `diffs` says where,
 * so the UI can warn instead of letting a quietly wrong document through.
 *
 * The reference-sign list is written back too, but only when the source marks
 * it out unambiguously — see refListWritable. When it does not, the other
 * buffers still export and `refList` reports why the list was left alone, so
 * the caller can say so rather than let the user believe an edit was saved.
 *
 * @param {ImportResult|null} imported
 * @param {{description: string, claims: string, refList?: string}} buffers
 * @param {{claimsHeading?: string, refListHeading?: string}} [opts]
 * @returns {{bytes: Uint8Array, mode: 'roundTrip'|'fresh', verified: boolean,
 *   diffs: import('./docx/verify.js').SectionDiff[], verifyError?: string,
 *   refList: 'written'|'unchanged'|'noSection'|'ambiguous'|'table'}}
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
    // Verify the bytes we are actually handing over, list included — so the
    // check covers the third buffer rather than the two it used to.
    const bytes = writeDocx(imported.doc, write);
    const check = verifyExport(bytes, buffers);
    // `'reason' in can` rather than `!can.ok`: an `in` check narrows the union
    // to the member that actually carries the property.
    const refListStatus = 'reason' in can ? can.reason : unchanged ? 'unchanged' : 'written';
    return {
      bytes,
      mode: 'roundTrip',
      verified: check.ok,
      diffs: check.diffs,
      verifyError: check.error,
      refList: refListStatus,
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
  // Nothing to verify against either: a fresh file is built from the buffers
  // rather than spliced into an existing document, so there is no third party
  // whose structure the write could disagree with.
  return {
    bytes: createDocx(sections),
    mode: 'fresh',
    verified: true,
    diffs: [],
    refList: refList.trim() ? 'written' : 'unchanged',
  };
}

export { DocxError };
