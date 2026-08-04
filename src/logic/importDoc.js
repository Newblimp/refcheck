// ── IMPORT / EXPORT ORCHESTRATION ────────────────────────────────────────────
// Thin, format-agnostic seam between the UI and the readers/writers. Keeping it
// here (rather than in App.jsx) means the whole import pipeline stays testable
// under the node environment.

import { readDocx, DocxError } from './docx/read.js';
import { writeDocx, createDocx } from './docx/write.js';
import { splitPatentDoc } from './docSplit.js';
import { detectLang } from './detectLang.js';

const ACCEPTED = /\.(docx|docm)$/i;

/**
 * Classify a filename before we bother reading it.
 * @returns {'ok'|'legacyDoc'|'unsupported'}
 */
export function fileKind(name) {
  const n = String(name || '');
  if (ACCEPTED.test(n)) return 'ok';
  if (/\.doc$/i.test(n)) return 'legacyDoc'; // binary OLE — not readable in-browser
  return 'unsupported';
}

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
 * @param {ImportResult|null} imported
 * @param {{description: string, claims: string}} buffers
 * @param {{claimsHeading?: string}} [opts]
 * @returns {{bytes: Uint8Array, mode: 'roundTrip'|'fresh'}}
 */
export function exportPatentDoc(imported, buffers, opts = {}) {
  if (imported?.doc) {
    const bytes = writeDocx(imported.doc, [
      { paras: imported.split.descParas, text: buffers.description },
      { paras: imported.split.claimsParas, text: buffers.claims },
    ]);
    return { bytes, mode: 'roundTrip' };
  }
  const sections = [];
  if (buffers.description) sections.push({ text: buffers.description });
  if (buffers.claims) sections.push({ heading: opts.claimsHeading || 'Claims', text: buffers.claims });
  return { bytes: createDocx(sections), mode: 'fresh' };
}

export { DocxError };
