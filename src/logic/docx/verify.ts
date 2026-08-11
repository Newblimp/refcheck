// ── EXPORT VERIFICATION ──────────────────────────────────────────────────────
// After writing the file, read it back and check it says what the buffers say.
//
// Why this exists: every other guard in the export path is a guard against a
// failure mode somebody already found. This one does not need to know the
// failure mode. It re-runs the whole import pipeline over the bytes the user is
// about to download and compares the result with the text they were looking at,
// so a splice that lands one character off, a paragraph written into the wrong
// range, or a construct nobody anticipated shows up as a reported difference
// instead of as a quietly wrong patent application.
//
// It is not free of judgement — two differences are expected and are normalized
// away rather than reported:
//
//   • blank lines at the edges of a section, which the importer trims
//   • claim numbers, when the claims are a Word list. Word owns the numbering
//     there, so the file deliberately does not contain the numbers the buffer
//     shows — and the numbers it will render need not match the ones the user
//     typed, which is the whole point of the claim-numbering check
//
// Anything else is a real difference and is reported.

import { DocxError, readDocx } from './read.ts';
import { splitPatentDoc } from '../docSplit.ts';
import { trimBlankEdges } from '../blankEdges.ts';
import { stripInvalidXmlChars } from './xmlText.ts';
import { stripClaimNumber } from '../constants.ts';

/** The comparable line array for one side of the comparison. */
function lines(
  text: string | null | undefined,
  { dropClaimNumbers = false }: LineOpts = {}
): string[] {
  const ls = trimBlankEdges(
    String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
  );
  return dropClaimNumbers ? ls.map(stripClaimNumber) : ls;
}

/** Index of the first differing line, or -1. */
function firstDiff(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

interface LineOpts {
  dropClaimNumbers?: boolean;
}

/** Which section a difference was found in. */
export type DiffSection = 'description' | 'claims';

/** One reported difference between the exported file and the buffer. */
export interface SectionDiff {
  section: DiffSection;
  /** 1-based line number of the first difference. */
  line: number;
  /** What the buffer says on that line ('' past its end). */
  expected: string;
  /** What the exported file says there. */
  actual: string;
}

export interface VerifyResult {
  ok: boolean;
  diffs: SectionDiff[];
  /**
   * Set when the file could not be read back at all — a corrupt export, the
   * most serious of the three outcomes.
   */
  error?: string;
}

/**
 * Re-read an exported .docx and compare it with the buffers it was written from.
 *
 * @param bytes   Output of writeDocx
 * @param buffers What the user sees
 */
export function verifyExport(
  bytes: Uint8Array,
  buffers: { description: string; claims: string }
): VerifyResult {
  let split;
  try {
    split = splitPatentDoc(readDocx(bytes));
  } catch (e) {
    const code = e instanceof DocxError ? e.code : undefined;
    return { ok: false, diffs: [], error: code ?? 'unreadable' };
  }

  // Word owns the claim numbers when the section is a list, so the re-imported
  // text carries numbers the writer synthesized rather than the ones the user
  // typed. Comparing those would report a difference on every claim.
  const listNumbered = split.detected.synthesizedClaimNumbers > 0;

  const diffs: SectionDiff[] = [];
  const check = (section: DiffSection, expected: string, actual: string, opts?: LineOpts): void => {
    // The writer drops characters XML cannot represent, so compare against what
    // it set out to write rather than against the raw buffer.
    const want = lines(stripInvalidXmlChars(expected), opts);
    const got = lines(actual, opts);
    const at = firstDiff(want, got);
    if (at >= 0)
      diffs.push({ section, line: at + 1, expected: want[at] ?? '', actual: got[at] ?? '' });
  };

  check('description', buffers.description, split.description);
  check('claims', buffers.claims, split.claims, { dropClaimNumbers: listNumbered });

  return { ok: diffs.length === 0, diffs };
}
