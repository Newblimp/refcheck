import { useCallback, useRef, useState } from 'react';
import { fileKind } from '../logic/fileKind.ts';
import { useFileDrop } from './useFileDrop.ts';
import type { ExportResult, ImportResult, RefListStatus } from '../logic/importDoc.ts';
import type { Lang } from '../logic/constants.ts';
import type { ExportDiffSummary, Strings } from '../i18n.ts';

// ── useDocumentIO ────────────────────────────────────────────────────────────
// The whole .docx round trip: picking or dropping a file, reading it into the
// buffers, undoing that, and writing the buffers back out again.
//
// This was ~170 lines in the middle of App — and it is logic wearing a
// component's clothes: nothing in it renders. Out here the import/export flow
// can be reasoned about (and tested) without mounting the app, and App is left
// holding state and wiring.
//
// The hook does NOT own the buffers. It reads them through `buffers` and writes
// through `apply`, so App keeps deciding what a load means for the rest of its
// state (clearing the focused error, for instance). The banner text is returned
// as i18n KEYS rather than resolved strings: an import may have just switched
// the language, and resolving at render time also keeps an open banner correct
// if the user toggles EN/DE afterwards.

// The .docx pipeline (and fflate with it) is loaded on demand — most sessions
// paste text and never touch it, so it does not belong in the initial bundle.
// The service worker precaches every emitted chunk, so this still resolves
// offline for a user who imports for the first time with no connection.
const loadDocIO = () => import('../logic/importDoc.ts');

// Why an edited reference list was left out of the export, per refListWritable.
const REF_SKIPPED: Partial<Record<RefListStatus, keyof Strings>> = {
  noSection: 'expRefNoSection',
  ambiguous: 'expRefAmbiguous',
  table: 'expRefTable',
};

/** The three buffers this hook reads and writes. */
export interface IOBuffers {
  description: string;
  claims: string;
  refList: string;
}

/** One extra line under the banner's headline. */
export interface BannerWarning {
  key: keyof Strings;
  /** Argument for the i18n formatter, when it takes one. */
  arg?: number | ExportDiffSummary;
}

/**
 * What the import/export banner should say.
 *
 * Deliberately one shape with optional fields rather than a union: the banner
 * renders whichever parts are present, and an import summary and an error
 * report differ by which fields are filled rather than by kind alone (a `warn`
 * is either).
 */
export interface IOReport {
  kind: 'ok' | 'warn' | 'error';
  /** i18n key naming what happened; absent for a plain import summary. */
  messageKey?: keyof Strings;
  descChars?: number;
  claimsChars?: number;
  lang?: Lang;
  warnings?: BannerWarning[];
}

export interface DocumentIOOpts {
  /** Resolved i18n strings (for the confirm dialogs only). */
  t: Strings;
  lang: Lang;
  buffers: IOBuffers;
  /** Load a document (or an undo) into App. */
  apply: (next: IOBuffers & { lang: Lang }) => void;
}

export function useDocumentIO({ t, lang, buffers, apply }: DocumentIOOpts) {
  // The parsed source document plus the paragraph provenance round-trip export
  // needs. Deliberately NOT persisted — a 200 KB document would blow the
  // localStorage quota alongside the text buffers — so a refresh keeps the text
  // but drops round-trip export.
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [report, setReport] = useState<IOReport | null>(null);
  const undoRef = useRef<(IOBuffers & { lang: Lang }) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Live mirrors, so every callback below can be a stable identity rather than
  // re-created on each keystroke.
  const bufRef = useRef(buffers);
  bufRef.current = buffers;
  const langRef = useRef(lang);
  langRef.current = lang;
  const tRef = useRef(t);
  tRef.current = t;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const handleFile = useCallback(async (file: File) => {
    const kind = fileKind(file?.name);
    if (kind !== 'ok') {
      setReport({
        kind: 'error',
        messageKey: kind === 'legacyDoc' ? 'impErrLegacy' : 'impErrUnsupported',
      });
      return;
    }
    let result: ImportResult;
    try {
      const { importPatentDoc } = await loadDocIO();
      result = importPatentDoc(await file.arrayBuffer());
    } catch {
      setReport({ kind: 'error', messageKey: 'impErrRead' });
      return;
    }
    const cur = bufRef.current;
    // Filling the buffers discards whatever is in them — same stance Reset takes.
    if (
      (cur.description || cur.claims) &&
      typeof window !== 'undefined' &&
      !window.confirm(tRef.current.impConfirm)
    )
      return;

    undoRef.current = { ...cur, lang: langRef.current };
    const { split, lang: detectedLang } = result;
    result.fileName = file.name;
    applyRef.current({
      description: split.description,
      claims: split.claims,
      // The Bezugszeichenliste is excluded from both buffers, but it is exactly
      // what the reference-list check wants, so hand it over instead of dropping
      // it. An absent one must not wipe a list the user already pasted.
      refList: split.signList || cur.refList,
      lang: detectedLang,
    });
    setImported(result);

    const warnings: BannerWarning[] = [];
    const d = split.detected;
    if (!d.description) warnings.push({ key: 'impNoDesc' });
    if (!d.claims) warnings.push({ key: 'impNoClaims' });
    if (d.synthesizedClaimNumbers)
      warnings.push({ key: 'impRenumbered', arg: d.synthesizedClaimNumbers });
    if (d.unusualNumbering) warnings.push({ key: 'impUnusualNum' });
    setReport({
      kind: warnings.length ? 'warn' : 'ok',
      descChars: split.description.length,
      claimsChars: split.claims.length,
      lang: detectedLang,
      warnings,
    });
  }, []);

  const dragging = useFileDrop(handleFile);

  const pickFile = useCallback(
    (e: { target: HTMLInputElement }) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // re-selecting the same file must fire change again
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const openPicker = useCallback(() => fileRef.current?.click(), []);

  const undoImport = useCallback(() => {
    const u = undoRef.current;
    if (!u) return;
    applyRef.current({
      description: u.description,
      claims: u.claims,
      refList: u.refList ?? '',
      lang: u.lang,
    });
    setImported(null);
    setReport(null);
    undoRef.current = null;
  }, []);

  const doExport = useCallback(async () => {
    const { exportPatentDoc } = await loadDocIO();
    const cur = bufRef.current;
    const l = langRef.current;
    let result: ExportResult;
    try {
      result = exportPatentDoc(imported, cur, {
        claimsHeading: l === 'de' ? 'Patentansprüche' : 'Claims',
        refListHeading: l === 'de' ? 'Bezugszeichenliste' : 'Reference signs',
      });
    } catch {
      // The writer refuses to emit a document it knows is broken. Say so —
      // silently downloading nothing is the one outcome a drafter cannot act on.
      setReport({ kind: 'error', messageKey: 'expErrFailed' });
      return;
    }
    const { bytes, verified, diffs = [], refList } = result;
    // The file was written, but reading it back did not reproduce the buffers.
    // It is still handed over — the drafter needs a way to get their work out —
    // with a warning naming the first place the two disagree. That outranks a
    // skipped reference list: one says the file may be wrong, the other says a
    // part of it was deliberately not touched.
    if (!verified) {
      const d = diffs[0];
      setReport({
        kind: 'warn',
        messageKey: 'expErrUnverified',
        warnings: d ? [{ key: 'expDiffAt', arg: d }] : [],
      });
    } else {
      const skipped = REF_SKIPPED[refList];
      if (skipped) setReport({ kind: 'warn', messageKey: skipped });
    }
    const base = imported?.fileName ? imported.fileName.replace(/\.docm?x?$/i, '') : 'refcheck';
    const blob = new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-checked.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [imported]);

  /** Forget the imported document — part of Reset all. */
  const clear = useCallback(() => {
    setImported(null);
    setReport(null);
    undoRef.current = null;
  }, []);

  return {
    imported,
    report,
    setReport,
    dragging,
    fileRef,
    pickFile,
    openPicker,
    doExport,
    undoImport,
    // The banner offers Undo only for a load that actually replaced something,
    // never for an error report.
    canUndo: !!undoRef.current && !report?.messageKey,
    clear,
  };
}
