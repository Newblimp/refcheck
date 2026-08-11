// ── PATENT DOCUMENT SPLITTER ─────────────────────────────────────────────────
// Turns the format-agnostic paragraph model into the tool's two buffers.
//
// Boundaries come from dedicated heading lines (see headings.js) — never from
// guessing at surrounding prose. That makes the split deterministic and gives it
// a clean failure mode: if no heading matches we do not invent a boundary, we
// hand back the whole document and say so, which is far better than a
// plausible-looking wrong slice.
//
//   Description = after a detailedDesc heading → next claims/signList heading
//   Claims      = after a claims heading       → next signList/abstract heading

import { SECTION_KINDS, matchHeading } from './headings.js';
import { trimBlankEdges } from './blankEdges.ts';
import { CLAIM_NUM_PREFIX_RE } from './constants.ts';

/**
 * @typedef {Object} SplitResult
 * @property {string} description   Text for the Description buffer
 * @property {string} claims        Text for the Claims buffer
 * @property {'en'|'de'|null} lang  Language implied by the matched headings
 * @property {Object} detected      What was found, for the UI banner
 * @property {import('./docx/read.js').Para[]} descParas   Paragraphs backing `description`
 * @property {import('./docx/read.js').Para[]} claimsParas Paragraphs backing `claims`
 * @property {string} signList  The Bezugszeichenliste, excluded from both
 *   buffers but handed back so the reference-list check can use it
 * @property {import('./docx/read.js').Para[]} signListParas  Paragraphs backing
 *   `signList` — what refListWritable inspects and export splices into
 */

/** Locate every heading in the document, in order. */
function findHeadings(paragraphs) {
  const out = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const hit = matchHeading(paragraphs[i].text);
    if (hit) out.push({ ...hit, index: i });
  }
  return out;
}

/** First heading of `kind` at or after `from`. */
const firstOf = (headings, kind, from = 0) =>
  headings.find((h) => h.kind === kind && h.index >= from) || null;

/** First heading of any kind in `kinds` strictly after `after`. */
const nextOf = (headings, kinds, after) =>
  headings.find((h) => h.index > after && kinds.includes(h.kind)) || null;

/**
 * Word auto-numbering lives in numbering.xml, not in the text — so an
 * auto-numbered claim arrives as "A device comprising…" with no "1.".
 * isClaimNumber() (constants.js) needs a literal line-leading digit, so without
 * this every claims-mode check silently goes dead.
 *
 * We synthesize "N. " for auto-numbered paragraphs that do not already start
 * with a number. Only the common single-level decimal case is reconstructed;
 * deeper levels are left alone and reported via `unusualNumbering` so the UI can
 * warn rather than guess. The injected prefix is recorded on the provenance
 * handle so export can strip it again (otherwise Word would double-number).
 */
function applyClaimNumbering(paras) {
  const counters = new Map();
  let synthesized = 0,
    unusual = false;
  const out = paras.map((p) => {
    if (!p.numbered) return p;
    if (p.ilvl > 0) {
      unusual = true;
      return p;
    }
    if (CLAIM_NUM_PREFIX_RE.test(p.text)) return p; // already numbered in text
    if (!p.text.trim()) return p;
    const key = p.numId == null ? '_' : String(p.numId);
    const n = (counters.get(key) || 0) + 1;
    counters.set(key, n);
    synthesized++;
    const prefix = `${n}. `;
    return { ...p, text: prefix + p.text, src: { ...p.src, synthesizedPrefix: prefix } };
  });
  return { paras: out, synthesized, unusual };
}

/** Join paragraphs into buffer text, trimming leading/trailing blank lines.
 *  The trimming rule is shared with docx/write.planEdits, which has to rebuild
 *  this exact line array to diff against. */
function toText(paras) {
  return trimBlankEdges(paras.map((p) => p.text)).join('\n');
}

/** Do two paragraph runs cover any of the same bytes of document.xml? */
const intersects = (a, b) =>
  a.some((x) => b.some((y) => x.src.xmlStart < y.src.xmlEnd && y.src.xmlStart < x.src.xmlEnd));

/**
 * Can an edited reference-sign list be written back into the source document?
 *
 * Export rewrites the paragraphs a buffer came from, which is only meaningful
 * when those paragraphs are unambiguously the list and nothing else. Three ways
 * that fails, each of which would damage the file rather than update it:
 *
 *  - `noSection`: no sign-list heading, so there is no region to write into.
 *  - `ambiguous`: the list's paragraphs are also part of the description or
 *    claims buffer. With no detailed-description heading the splitter falls
 *    back to "everything before the claims", which swallows a list placed
 *    there — two buffers would then plan edits over the same bytes.
 *  - `table`: the list is a table, so every cell is its own paragraph and the
 *    buffer reads "10 / device / 12 / housing" down the lines. Diffing edited
 *    text against that moves values between cells.
 *
 * The caller exports the other buffers regardless and reports the reason; the
 * list is never guessed at.
 *
 * @param {SplitResult} split
 * @returns {{ok: true} | {ok: false, reason: 'noSection'|'ambiguous'|'table'}}
 */
export function refListWritable(split) {
  const paras = split?.signListParas || [];
  if (!split?.detected?.signList || !paras.length) return { ok: false, reason: 'noSection' };
  if (paras.some((p) => p.inTable)) return { ok: false, reason: 'table' };
  if (
    split.detected.fellBack ||
    intersects(paras, split.descParas || []) ||
    intersects(paras, split.claimsParas || [])
  ) {
    return { ok: false, reason: 'ambiguous' };
  }
  return { ok: true };
}

/**
 * Split a parsed document into the Description and Claims buffers.
 * @param {{paragraphs: import('./docx/read.js').Para[]}} doc
 * @returns {SplitResult}
 */
export function splitPatentDoc(doc) {
  const paragraphs = doc?.paragraphs || [];
  const headings = findHeadings(paragraphs);

  const descH = firstOf(headings, SECTION_KINDS.DETAILED_DESC);
  const claimsH = firstOf(headings, SECTION_KINDS.CLAIMS);
  const signListH = firstOf(headings, SECTION_KINDS.SIGN_LIST);

  // ── section ranges ──────────────────────────────────────────────────────────
  // Each section runs from just after its own heading to the first heading of a
  // kind that normally follows it. That is right for a document laid out in the
  // usual order, and NOT enough on its own:
  //
  // A draft whose claims heading precedes the detailed-description heading (an
  // amendment sheet, a response to an office action) gave the claims a stop list
  // that does not mention the description, so the claims section ran to the end
  // of the document and swallowed the description whole. Both buffers then owned
  // the same paragraphs, and exporting wrote two different texts over one range
  // — the description section simply vanished from the exported file. The
  // buffers MUST be disjoint; export splices into the paragraphs they name.
  //
  // So every section is additionally clipped at every OTHER located section's
  // heading, which makes the ranges disjoint whatever order the document is in.
  // Deliberately only the sections actually located, not every heading of a
  // section kind: clipping at those would truncate a German description at its
  // own "Ausführungsbeispiel 2" subheading.
  const located = [descH, claimsH, signListH].filter(Boolean).map((h) => h.index);
  const rangeAfter = (heading, stopKinds) => {
    if (!heading) return [];
    const stop = nextOf(headings, stopKinds, heading.index);
    const end = Math.min(
      stop ? stop.index : paragraphs.length,
      ...located.filter((i) => i > heading.index)
    );
    return paragraphs.slice(heading.index + 1, end);
  };

  // Description: up to the claims, the sign list or the abstract.
  let descParas = rangeAfter(descH, [
    SECTION_KINDS.CLAIMS,
    SECTION_KINDS.SIGN_LIST,
    SECTION_KINDS.ABSTRACT,
  ]);

  // Claims: up to the sign list or the abstract.
  let claimsParas = rangeAfter(claimsH, [SECTION_KINDS.SIGN_LIST, SECTION_KINDS.ABSTRACT]);

  const numbering = applyClaimNumbering(claimsParas);
  claimsParas = numbering.paras;

  // The reference-sign list: excluded from the description and claims buffers,
  // but returned so it can be reconciled against them rather than discarded.
  // The list is commonly placed BEFORE the claims (Description →
  // Bezugszeichenliste/reference signs → Claims), not just after them, so both
  // stop kinds are needed or a list preceding the claims would run straight
  // through the claims heading and swallow the claims section too.
  const signListParas = rangeAfter(signListH, [SECTION_KINDS.CLAIMS, SECTION_KINDS.ABSTRACT]);

  // Language: whichever dictionary matched. The claims heading is the most
  // standardised, so it wins when the two disagree.
  const lang = claimsH?.lang || descH?.lang || null;

  // No detailed-description heading → do not guess. Hand back everything before
  // the claims (or the whole document) and let the banner say so.
  let fellBack = false;
  if (!descH) {
    fellBack = true;
    const end = claimsH ? claimsH.index : paragraphs.length;
    descParas = paragraphs.slice(0, end);
  }

  return {
    description: toText(descParas),
    claims: toText(claimsParas),
    signList: toText(signListParas),
    lang,
    descParas,
    claimsParas,
    signListParas,
    detected: {
      description: !!descH,
      claims: !!claimsH,
      signList: !!signListH,
      descHeading: descH ? paragraphs[descH.index].text.trim() : null,
      claimsHeading: claimsH ? paragraphs[claimsH.index].text.trim() : null,
      fellBack,
      synthesizedClaimNumbers: numbering.synthesized,
      unusualNumbering: numbering.unusual,
      headings: headings.map((h) => ({
        kind: h.kind,
        lang: h.lang,
        text: paragraphs[h.index].text.trim(),
      })),
    },
  };
}
