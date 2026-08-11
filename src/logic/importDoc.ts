// ── IMPORT / EXPORT ORCHESTRATION ────────────────────────────────────────────
// Thin, format-agnostic seam between the UI and the readers/writers. Keeping it
// here (rather than in App.jsx) means the whole import pipeline stays testable
// under the node environment.

import { readDocx, DocxError } from './docx/read.ts';
import { writeDocx, createDocx } from './docx/write.ts';
import { verifyExport } from './docx/verify.ts';
import { splitPatentDoc, refListWritable } from './docSplit.ts';
import { detectLang } from './detectLang.ts';
import { fileKind } from './fileKind.ts';
import type { NewSection, WriteBuffer } from './docx/write.ts';
import type { PatentDoc } from './docx/read.ts';
import type { SectionDiff } from './docx/verify.ts';
import type { RefListRefusal, SplitResult } from './docSplit.ts';
import type { LangSource } from './detectLang.ts';
import type { Lang } from './constants.ts';

// Re-exported so this module stays the single seam callers reason about, even
// though the implementation lives elsewhere to keep it out of the lazy chunk.
export { fileKind };

/** Everything one import produced, including the provenance export needs. */
export interface ImportResult {
  doc: PatentDoc;
  split: SplitResult;
  lang: Lang;
  langFrom: LangSource;
}

/** What happened to the reference-sign list on export. */
export type RefListStatus = 'written' | 'unchanged' | RefListRefusal;

/** Whether the export rewrote the source file or generated a new one. */
export type ExportMode = 'roundTrip' | 'fresh';

export interface ExportResult {
  bytes: Uint8Array;
  mode: ExportMode;
  verified: boolean;
  diffs: SectionDiff[];
  verifyError?: string;
  refList: RefListStatus;
}

/**
 * Read a .docx into buffers.
 * @throws {DocxError}
 */
export function importPatentDoc(buf: ArrayBuffer | Uint8Array): ImportResult {
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
 */
export function exportPatentDoc(
  imported: ImportResult | null | undefined,
  buffers: { description: string; claims: string; refList?: string },
  opts: { claimsHeading?: string; refListHeading?: string } = {}
): ExportResult {
  const refList = buffers.refList || '';
  if (imported?.doc) {
    const write: WriteBuffer[] = [
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
    // `!can.ok` narrows the union to the refusing member, which carries the
    // reason. (This was an `'reason' in can` check under JSDoc, where a boolean
    // discriminant did not narrow reliably; TypeScript handles it directly.)
    const refListStatus: RefListStatus = !can.ok ? can.reason : unchanged ? 'unchanged' : 'written';
    return {
      bytes,
      mode: 'roundTrip',
      verified: check.ok,
      diffs: check.diffs,
      verifyError: check.error,
      refList: refListStatus,
    };
  }
  const sections: NewSection[] = [];
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
