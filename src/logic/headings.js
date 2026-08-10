// ── SECTION HEADINGS ─────────────────────────────────────────────────────────
// The dictionary that drives .docx section detection. Everything here is DATA:
// adding a language means adding a key to each entry below, and adding a section
// kind means adding a row — neither touches control flow (see `matchHeading`).
//
// Detection is anchored on a *dedicated heading line*: the paragraph's entire
// text must be the heading. That is what keeps a sentence which merely mentions
// "Ansprüche" from being mistaken for the claims boundary.

export const SECTION_KINDS = {
  DETAILED_DESC: 'detailedDesc',
  CLAIMS: 'claims',
  FIGURE_LISTING: 'figureListing',
  SIGN_LIST: 'signList',
  ABSTRACT: 'abstract',
};

/**
 * Exact whole-line headings, by kind then language.
 *
 * Note that `brief description of the drawings` (figure listing) and
 * `description of the drawings` (detailed description) are DISTINCT keys here.
 * Because matching is exact on the whole normalized line, they cannot collide —
 * the ambiguity only exists for the prefix fallback below, which is ordered.
 */
export const HEADINGS = {
  [SECTION_KINDS.DETAILED_DESC]: {
    de: [
      'Detaillierte Beschreibung',
      'Detailierte Beschreibung', // frequent misspelling in real drafts
      'Detaillierte Beschreibung der Zeichnungen',
      'Detaillierte Beschreibung der Ausführungsbeispiele',
      'Detaillierte Beschreibung der Erfindung',
      'Figurenbeschreibung',
      'Beschreibung der Figuren',
      'Beschreibung der Zeichnungen',
      'Beschreibung der Ausführungsbeispiele',
      'Beschreibung bevorzugter Ausführungsformen',
      'Beschreibung der bevorzugten Ausführungsformen',
      'Ausführungsbeispiel',
      'Ausführungsbeispiele',
      'Ausführungsformen',
      'Bevorzugte Ausführungsformen',
    ],
    en: [
      'Detailed Description',
      'Detailed Description of the Invention',
      'Detailed Description of the Embodiments',
      'Detailed Description of the Preferred Embodiments',
      'Detailed Description of the Drawings',
      'Description of the Drawings',
      'Description of the Figures',
      'Description of Embodiments',
      'Description of the Embodiments',
      'Description of the Preferred Embodiments',
      'Preferred Embodiments',
    ],
  },
  [SECTION_KINDS.CLAIMS]: {
    de: ['Patentansprüche', 'Ansprüche', 'Schutzansprüche', 'Patentanspruch'],
    en: [
      'Claims',
      'Patent Claims',
      'Patent Claim',
      'What is claimed is',
      'What is claimed',
      'What we claim is',
      'We claim',
      'I claim',
      'The invention claimed is',
      'The claims defining the invention are as follows',
    ],
  },
  [SECTION_KINDS.FIGURE_LISTING]: {
    de: [
      'Kurzbeschreibung der Zeichnungen',
      'Kurze Beschreibung der Zeichnungen',
      'Kurzbeschreibung der Figuren',
      'Kurze Beschreibung der Figuren',
      'Kurzdarstellung der Zeichnungen',
      'Figurenübersicht',
      'Übersicht über die Zeichnungen',
    ],
    en: [
      'Brief Description of the Drawings',
      'Brief Description of the Figures',
      'Brief Description of Drawings',
      'Brief Description of the Several Views of the Drawings',
    ],
  },
  [SECTION_KINDS.SIGN_LIST]: {
    de: ['Bezugszeichenliste', 'Liste der Bezugszeichen', 'Bezugszeichen'],
    en: [
      'Reference Numerals',
      'Reference Signs',
      'List of Reference Signs',
      'List of Reference Numerals',
      'Reference Signs List',
      'Reference Numerals List',
    ],
  },
  [SECTION_KINDS.ABSTRACT]: {
    de: ['Zusammenfassung'],
    en: ['Abstract', 'Abstract of the Disclosure', 'Summary'],
  },
};

// Prefix fallback for the long tail ("Detailed Description of the Preferred
// Embodiments of the Present Invention…"). ORDER MATTERS: longest / most
// specific first, so `brief description of the` claims the line before
// `description of the` can. Only applied to short lines (see MAX_HEADING_LEN),
// which is what keeps a prose paragraph from matching a prefix.
const PREFIXES = [
  ['brief description of the', SECTION_KINDS.FIGURE_LISTING, 'en'],
  ['brief description of', SECTION_KINDS.FIGURE_LISTING, 'en'],
  ['kurzbeschreibung der', SECTION_KINDS.FIGURE_LISTING, 'de'],
  ['kurze beschreibung der', SECTION_KINDS.FIGURE_LISTING, 'de'],
  ['kurzdarstellung der', SECTION_KINDS.FIGURE_LISTING, 'de'],
  ['detaillierte beschreibung', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['detailierte beschreibung', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['detailed description', SECTION_KINDS.DETAILED_DESC, 'en'],
  ['description of the preferred embodiment', SECTION_KINDS.DETAILED_DESC, 'en'],
  ['description of the embodiment', SECTION_KINDS.DETAILED_DESC, 'en'],
  ['description of embodiment', SECTION_KINDS.DETAILED_DESC, 'en'],
  ['description of the drawing', SECTION_KINDS.DETAILED_DESC, 'en'],
  ['description of the figure', SECTION_KINDS.DETAILED_DESC, 'en'],
  ['beschreibung der ausführungs', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['beschreibung bevorzugter ausführungs', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['beschreibung der figuren', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['beschreibung der zeichnungen', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['figurenbeschreibung', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['ausführungsbeispiel', SECTION_KINDS.DETAILED_DESC, 'de'],
  ['patentansprüche', SECTION_KINDS.CLAIMS, 'de'],
  ['schutzansprüche', SECTION_KINDS.CLAIMS, 'de'],
  ['ansprüche', SECTION_KINDS.CLAIMS, 'de'],
  ['what is claimed', SECTION_KINDS.CLAIMS, 'en'],
  ['what we claim', SECTION_KINDS.CLAIMS, 'en'],
  ['the invention claimed is', SECTION_KINDS.CLAIMS, 'en'],
  ['patent claims', SECTION_KINDS.CLAIMS, 'en'],
  ['patent claim', SECTION_KINDS.CLAIMS, 'en'],
  ['claims', SECTION_KINDS.CLAIMS, 'en'],
  ['bezugszeichenliste', SECTION_KINDS.SIGN_LIST, 'de'],
  ['liste der bezugszeichen', SECTION_KINDS.SIGN_LIST, 'de'],
  ['list of reference', SECTION_KINDS.SIGN_LIST, 'en'],
  ['reference numerals', SECTION_KINDS.SIGN_LIST, 'en'],
  ['reference signs', SECTION_KINDS.SIGN_LIST, 'en'],
  ['zusammenfassung', SECTION_KINDS.ABSTRACT, 'de'],
  ['abstract', SECTION_KINDS.ABSTRACT, 'en'],
];

// A heading is a short line. Anything longer is prose that happens to start with
// a heading-ish phrase, and must not move a section boundary.
const MAX_HEADING_LEN = 60;

// Leading section label: "III.", "B)", "2." — stripped before matching. The
// delimiter is required, so the "I" of "I claim" is never eaten.
const LEAD_LABEL_RE = /^(?:\d{1,3}|[IVXLCDM]{1,6}|[A-Za-z])[.)]\s+/;

/** Normalize a line for heading comparison: unify whitespace (Word emits plenty
 *  of non-breaking spaces), drop a leading section label, drop trailing
 *  punctuation, lowercase. */
export function normalizeHeading(line) {
  let s = String(line == null ? '' : line)
    .replace(/[   \t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(LEAD_LABEL_RE, '').trim();
  s = s.replace(/[:.–—\-\s]+$/, '').trim();
  return s.toLowerCase();
}

// Exact lookup: normalized heading → {kind, lang}. Built once at module load.
const EXACT = new Map();
for (const [kind, byLang] of Object.entries(HEADINGS)) {
  for (const [lang, list] of Object.entries(byLang)) {
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      const k = normalizeHeading(h);
      if (k && !EXACT.has(k)) EXACT.set(k, { kind, lang });
    }
  }
}

/**
 * Classify a single line as a section heading.
 * @param {string} line The paragraph's full text.
 * @returns {{kind: string, lang: 'en'|'de', exact: boolean}|null}
 */
export function matchHeading(line) {
  const norm = normalizeHeading(line);
  if (!norm) return null;
  const hit = EXACT.get(norm);
  if (hit) return { kind: hit.kind, lang: hit.lang, exact: true };
  if (norm.length > MAX_HEADING_LEN) return null;
  for (const [prefix, kind, lang] of PREFIXES) {
    if (norm.startsWith(prefix))
      return { kind, lang: /** @type {'en'|'de'} */ (lang), exact: false };
  }
  return null;
}
