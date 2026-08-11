// ── CLAIM NUMBERING ON EXPORT ────────────────────────────────────────────────
// A claim's number can live in one of two places, and the exported file has to
// put it back where the source had it:
//
//   Word list   the paragraph carries <w:numPr>, Word renders the number, and
//               the text itself starts straight at "A device comprising…"
//   typed       the number is literal text at the start of the paragraph and no
//               <w:numPr> exists
//
// The import papers over the difference — it synthesizes "N. " for Word-numbered
// claims so the rest of the tool can find them (see docSplit.applyClaimNumbering)
// — so the writer has to undo that paper-over, and it has to do it per section
// rather than per paragraph. Which paragraph a claim line lands in is an
// artefact of the diff; how the section numbers its claims is not.
//
// Everything here is a pure function of a paragraph plus a line of text; nothing
// touches the zip or the buffer.

import { CLAIM_NUM_PREFIX_RE, startsWithClaimNumber, stripClaimNumber } from '../constants.ts';
import type { Para } from './read.ts';

/** `<w:numPr>…</w:numPr>`, self-closing or not — removing it un-lists a paragraph. */
export const NUMPR_RE = /<w:numPr\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:numPr>)/g;

/** Is this line a claim (i.e. does it open with a number)? */
export const isClaimLine = startsWithClaimNumber;

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
export function stripAutoNumber(text: string, para: Para): string {
  return para.src.synthesizedPrefix ? stripClaimNumber(text) : text;
}

/**
 * The claim paragraph that shows how this section numbers its claims, or null
 * when the numbers are typed into the text.
 *
 * A synthesized prefix is the marker: the import injects one exactly when Word
 * numbers the paragraph itself (single-level decimal `<w:numPr>`), so its
 * presence proves the section is a Word list rather than typed "1. " text.
 *
 * @param paras The claims section's paragraphs
 */
export function claimListTemplate(paras: Para[]): Para | null {
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
 *
 * Only lines that open with a claim number are touched, which is what leaves a
 * lead-in line alone: it is not a claim, so it must not join the list and take
 * a number of its own.
 *
 * @param para    The paragraph the line landed in
 * @param listTpl From claimListTemplate
 */
export function conformClaim(
  para: Para,
  line: string,
  listTpl: Para | null
): { para: Para; text: string } {
  // Multi-level numbering is the case docSplit refuses to guess at (it
  // synthesizes no number and flags `unusualNumbering`); guessing here instead
  // would be no better informed.
  if (para.ilvl > 0 || !isClaimLine(line)) return { para, text: stripAutoNumber(line, para) };

  if (listTpl) {
    // Word supplies the number, so the paragraph must be a list item and the
    // typed number must go.
    const src = {
      ...para.src,
      pPrXml: listTpl.src.pPrXml,
      synthesizedPrefix: listTpl.src.synthesizedPrefix,
    };
    return { para: { ...para, src, numbered: true }, text: stripClaimNumber(line) };
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

export { CLAIM_NUM_PREFIX_RE };
