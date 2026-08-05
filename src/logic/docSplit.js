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

/**
 * @typedef {Object} SplitResult
 * @property {string} description   Text for the Description buffer
 * @property {string} claims        Text for the Claims buffer
 * @property {'en'|'de'|null} lang  Language implied by the matched headings
 * @property {Object} detected      What was found, for the UI banner
 * @property {import('./docx/read.js').Para[]} descParas   Paragraphs backing `description`
 * @property {import('./docx/read.js').Para[]} claimsParas Paragraphs backing `claims`
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
    if (/^\s*\d{1,4}\s*[.)]/.test(p.text)) return p; // already numbered in text
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

/** Join paragraphs into buffer text, trimming leading/trailing blank lines. */
function toText(paras) {
  const lines = paras.map((p) => p.text);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
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

  // Description: from just after its heading up to the claims or the sign list.
  let descParas = [];
  if (descH) {
    const stop = nextOf(
      headings,
      [SECTION_KINDS.CLAIMS, SECTION_KINDS.SIGN_LIST, SECTION_KINDS.ABSTRACT],
      descH.index
    );
    descParas = paragraphs.slice(descH.index + 1, stop ? stop.index : paragraphs.length);
  }

  // Claims: from just after its heading up to the sign list or the abstract.
  let claimsParas = [];
  if (claimsH) {
    const stop = nextOf(headings, [SECTION_KINDS.SIGN_LIST, SECTION_KINDS.ABSTRACT], claimsH.index);
    claimsParas = paragraphs.slice(claimsH.index + 1, stop ? stop.index : paragraphs.length);
  }

  const numbering = applyClaimNumbering(claimsParas);
  claimsParas = numbering.paras;

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
    lang,
    descParas,
    claimsParas,
    detected: {
      description: !!descH,
      claims: !!claimsH,
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
