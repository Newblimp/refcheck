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

import { readDocx } from './read.js';
import { splitPatentDoc } from '../docSplit.js';
import { trimBlankEdges } from '../blankEdges.ts';
import { stripInvalidXmlChars } from './xmlText.js';
import { stripClaimNumber } from '../constants.ts';

/** The comparable line array for one side of the comparison. */
function lines(text, { dropClaimNumbers = false } = {}) {
  const ls = trimBlankEdges(
    String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
  );
  return dropClaimNumbers ? ls.map(stripClaimNumber) : ls;
}

/** Index of the first differing line, or -1. */
function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/**
 * @typedef {Object} SectionDiff
 * @property {'description'|'claims'} section
 * @property {number} line      1-based line number of the first difference
 * @property {string} expected  What the buffer says on that line ('' past its end)
 * @property {string} actual    What the exported file says there
 */

/**
 * Re-read an exported .docx and compare it with the buffers it was written from.
 *
 * @param {Uint8Array} bytes Output of writeDocx
 * @param {{description: string, claims: string}} buffers What the user sees
 * @returns {{ok: boolean, diffs: SectionDiff[], error?: string}}
 *   `error` is set when the file could not be read back at all — that is a
 *   corrupt export, the most serious outcome of the three.
 */
export function verifyExport(bytes, buffers) {
  let split;
  try {
    split = splitPatentDoc(readDocx(bytes));
  } catch (e) {
    return { ok: false, diffs: [], error: e?.code || 'unreadable' };
  }

  // Word owns the claim numbers when the section is a list, so the re-imported
  // text carries numbers the writer synthesized rather than the ones the user
  // typed. Comparing those would report a difference on every claim.
  const listNumbered = split.detected.synthesizedClaimNumbers > 0;

  const diffs = [];
  const check = (section, expected, actual, opts) => {
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
