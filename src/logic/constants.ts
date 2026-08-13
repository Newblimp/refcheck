import type { Token } from './tokenize.ts';

// ── SHARED VOCABULARY ────────────────────────────────────────────────────────
// The handful of string unions the whole app agrees on. They were plain strings
// before, compared against literals in two dozen places — so a typo'd 'claim'
// (for 'claims') silently selected the description branch everywhere.

/** UI and checking language. */
export type Lang = 'en' | 'de';

/** Which buffer is being checked; claims mode adds the parenthesis and
 *  claim-structure rules and switches article checking to antecedent basis. */
export type Mode = 'description' | 'claims';

/** Definite vs indefinite, the distinction the article check turns on. */
export type ArticleType = 'def' | 'indef';

// ── CONSTANTS ──────────────────────────────────────────────────────────────
// Words that, when they precede a number, should NOT be treated as the term for
// that reference sign (articles, prepositions, cross-reference words, etc.).
export const EXCL = new Set([
  'figure',
  'figures',
  'fig',
  'figs',
  'claim',
  'claims',
  'paragraph',
  'page',
  'table',
  'equation',
  'reference',
  'numeral',
  'number',
  'no',
  'nr',
  'see',
  'note',
  'wherein',
  'whereby',
  'comprising',
  'having',
  'including',
  'being',
  'said',
  'respective',
  'at',
  'in',
  'of',
  'on',
  'to',
  'by',
  'as',
  'an',
  'a',
  'the',
  'with',
  'from',
  'via',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'has',
  'have',
  'had',
  'that',
  'this',
  'these',
  'those',
  'such',
  'each',
  'least',
  'more',
  'less',
  'than',
  'about',
  'approximately',
  'around',
  'roughly',
  'substantially',
  'maximal',
  'minimal',
  'maximum',
  'minimum',
  'between',
  'through',
  'into',
  'according',
  'further',
  'also',
  'only',
  'each',
  'any',
  'all',
  'both',
  // German
  'figur',
  'figuren',
  'abbildung',
  'abbildungen',
  'abb',
  'anspruch',
  'ansprüche',
  'ansprüchen',
  'anspruchs',
  'anspruches',
  'seite',
  'schritt',
  'tabelle',
  'bezugszeichen',
  'ziffer',
  'wobei',
  'umfassend',
  'aufweisend',
  'gemäß',
  'bei',
  'nach',
  'vor',
  'über',
  'unter',
  'durch',
  'für',
  'von',
  'mit',
  'zu',
  'an',
  'am',
  'bis',
  'um',
  'ca',
  'circa',
  'etwa',
  'ungefähr',
  'wesentlichen',
  'maximal',
  'minimal',
  'im',
  'in',
  'der',
  'die',
  'das',
  'dem',
  'den',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'eines',
  'einer',
  'und',
  'oder',
  'ist',
  'sind',
  'war',
  'waren',
  'hat',
  'haben',
  'sich',
  'auch',
  'nur',
  'noch',
  'bereits',
  'dabei',
  'hierbei',
  'hierdurch',
  'hierzu',
  'bzw',
  'beziehungsweise',
  'usw',
]);

export const EN_ART = new Set(['a', 'an', 'the']);
export const DE_ART = new Set([
  'der',
  'die',
  'das',
  'des',
  'dem',
  'den',
  'ein',
  'eine',
  'eines',
  'einer',
  'einem',
  'einen',
]);
export const EN_ORD = new Set([
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'further',
  'other',
  'another',
  'next',
  'upper',
  'lower',
  'inner',
  'outer',
  'front',
  'rear',
  'left',
  'right',
  'top',
  'bottom',
  'primary',
  'secondary',
  'main',
  'auxiliary',
  'additional',
]);
export const DE_ORD = new Set([
  'erste',
  'ersten',
  'erstem',
  'erster',
  'erstes',
  'zweite',
  'zweiten',
  'zweitem',
  'zweiter',
  'zweites',
  'dritte',
  'dritten',
  'vierte',
  'vierten',
  'weitere',
  'weiteren',
  'weiterer',
  'zusätzliche',
  'zusätzlichen',
  'primäre',
  'primären',
  'sekundäre',
  'sekundären',
  'obere',
  'oberen',
  'untere',
  'unteren',
  'innere',
  'inneren',
  'äußere',
  'äußeren',
  'vordere',
  'vorderen',
  'hintere',
  'hinteren',
  'linke',
  'linken',
  'rechte',
  'rechten',
  'andere',
  'anderen',
  'anderer',
]);

export const isArt = (w: string, l: Lang) => (l === 'de' ? DE_ART : EN_ART).has(w.toLowerCase());
export const isOrd = (w: string, l: Lang) => (l === 'de' ? DE_ORD : EN_ORD).has(w.toLowerCase());

// ── ORDINAL NUMBERINGS ───────────────────────────────────────────────────────
// A NUMBERING ("first" / "erste"), as opposed to the positions and qualifiers
// that also open a multi-word term ("upper", "vordere", "additional"). The
// distinction exists for exactly one rule: a term introduced with a numbering
// may be referred back to without it (logic/cumulative.ts). "the upper housing
// 12" later written "the housing 12" is NOT that case — the drafter may simply
// have lost the qualifier — so the ORD sets above are deliberately not reused.
//
// German ordinals inflect (erste/erster/erstes/erstem/ersten), so the set is
// built from stem × ending rather than spelled out sixty times.
//
// Neither set contains the other, and that is deliberate. These sets reach past
// the ORD ones (eleventh/twelfth; dritter/drittes, fünfte…zwölfte in every
// ending) because widening the ORD sets changes how EVERY term in every
// document is read, while widening these only changes what may be folded — and
// a form that is not in DE_ORD can still reach a multi-word term through the
// reference list or a manual override. constants.test.ts pins the split, and
// CLAUDE.md tabulates it under The Qualifier Vocabulary.
const DE_ORD_STEMS = [
  'erst',
  'zweit',
  'dritt',
  'viert',
  'fünft',
  'sechst',
  'siebt',
  'siebent',
  'acht',
  'neunt',
  'zehnt',
  'elft',
  'zwölft',
];
const DE_ORD_ENDINGS = ['e', 'en', 'er', 'es', 'em'];
export const DE_NUM_ORD = new Set(DE_ORD_STEMS.flatMap((s) => DE_ORD_ENDINGS.map((e) => s + e)));
export const EN_NUM_ORD = new Set([
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
]);
/** Is this word an ordinal NUMBERING (a subset of isOrd — see above)? */
export const isNumOrd = (w: string, l: Lang) =>
  (l === 'de' ? DE_NUM_ORD : EN_NUM_ORD).has(w.toLowerCase());
// Indefinite articles, EN + DE. A module-level Set: artType runs once per
// article occurrence, and the array literal was rebuilt on every call.
const INDEF_ARTS = new Set(['a', 'an', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen']);
export const artType = (w: string): ArticleType =>
  INDEF_ARTS.has(w.toLowerCase()) ? 'indef' : 'def';
export const likelySign = (s: string) => {
  const n = parseInt(s, 10);
  return n >= 1 && n <= 99999;
};

// ── LIST / RANGE CONNECTORS ──────────────────────────────────────────────────
// The words and dashes that join two numbers into a list or range, EN + DE.
// Shared by the sign-list scan (extract.js: "the bearings 18, 20 and 22") and the
// claim-reference parser (claims.js: "any one of claims 1 to 4"). These were two
// separate literals that had drifted apart — the sign scan was missing
// "or"/"oder"/"through", so "the bearings 18 or 22" registered only the first.
export const CONNECTOR_WORDS = ['and', 'und', 'or', 'oder', 'to', 'through', 'bis'];
export const RANGE_DASHES = '[-–—]';
// Alternation fragment, longest-first so "through" is not shadowed by a prefix.
export const CONNECTOR_ALT = [...CONNECTOR_WORDS].sort((a, b) => b.length - a.length).join('|');

// ── REFERENCE-SIGN PATTERN ───────────────────────────────────────────────────
// Single source of truth for what a reference sign looks like: 1–5 digits, an
// optional trailing letter (12a) and an optional trailing prime (10', 10′).
// SIGN_RE is a bare fragment (no anchors/groups) so it can be interpolated into
// the tokenizer's alternation and into an anchored test regex.
export const SIGN_RE = "\\d{1,5}[a-z]?['′]?";
export const SIGN_RE_ANCHORED = new RegExp('^(?:' + SIGN_RE + ')$');

// ── ROMAN-NUMERAL STEP SIGNS ─────────────────────────────────────────────────
// Method steps are labelled with UPPERCASE Roman numerals (I, II, IX, …) and
// substeps append a dot and an Arabic numeral with no space (I.1, II.2, IX.3).
// The leading (?=[IVXLCDM]) forces a non-empty match, so the fragment never
// matches a zero-width token; the strict alternation only accepts a valid Roman
// numeral (1–3999). ROMAN_RE is a bare fragment for interpolation, mirroring
// SIGN_RE. Only capital letters match, so lowercase units (mm, cm) are safe.
export const ROMAN_RE =
  '(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?:\\.\\d{1,3})?';
export const ROMAN_RE_ANCHORED = new RegExp('^(?:' + ROMAN_RE + ')$');

// A token is a sign if it is an Arabic sign (right shape AND numeric value in
// range) OR a Roman-numeral step/substep.
export const isSignToken = (s: string) =>
  (SIGN_RE_ANCHORED.test(s) && likelySign(s)) || ROMAN_RE_ANCHORED.test(s);

// Value of a Roman-numeral string (e.g. "XIV" → 14). Assumes a valid numeral —
// every caller passes a [IVXLCDM]+ capture group. The `?? 0` is what that
// assumption looks like once it is written down: an unknown character
// contributes nothing instead of poisoning the sum with NaN.
const ROMAN_VAL: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
export function romanToInt(r: string): number {
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const cur = ROMAN_VAL[r[i] ?? ''] ?? 0,
      nxt = ROMAN_VAL[r[i + 1] ?? ''] ?? 0;
    n += nxt && cur < nxt ? -cur : cur;
  }
  return n;
}
// Numeric value of a sign for ordering. Arabic → its integer (parseInt ignores a
// trailing letter/prime). Roman "II" → 2; a Roman substep "II.3" → 2 + 3/1000 so
// substeps cluster right after their parent step and before the next one.
export function signVal(s: string): number {
  const m = /^([IVXLCDM]+)(?:\.(\d+))?$/.exec(s);
  if (m) {
    const [, roman = '', sub] = m;
    return romanToInt(roman) + (sub ? parseInt(sub, 10) / 1000 : 0);
  }
  return parseInt(s, 10);
}
// Order signs: all Arabic signs first (by value, then suffix: 10 < 10' < 10a < 12),
// then all Roman steps grouped at the end (I < I.1 < II) — Arabic and Roman are
// never interleaved. Plain `+a-+b` yields NaN for primed/lettered/Roman signs,
// so always sort through this.
export const compareSigns = (a: string, b: string): number => {
  const ra = ROMAN_RE_ANCHORED.test(a),
    rb = ROMAN_RE_ANCHORED.test(b);
  if (ra !== rb) return ra ? 1 : -1;
  return signVal(a) - signVal(b) || a.localeCompare(b);
};

// ── DISMISSAL KEYS ───────────────────────────────────────────────────────────
// Single place that defines the "<prefix>:<id>" scheme used to identify a
// dismissed error. Shared by App, getAllErrors, buildHtml and the sidebar
// cards — never assemble these strings by hand.
export const disKey = {
  sign: (sign: string) => 's:' + sign, // id: the sign itself
  art: (termStem: string) => 'a:' + termStem, // id: the term stem
  bare: (termStem: string) => 'b:' + termStem, // id: the term stem
  num: (key: string) => 'n:' + key, // id: numError.key (value#ordinal — edit-stable)
  dep: (key: string) => 'd:' + key, // id: depError.key (claim>ref#ordinal)
};

// The same rule as isClaimNumber, applied to a whole line rather than a token:
// a leading Arabic number followed by '.' or ')'. `CLAIM_NUM_PREFIX_RE` also
// eats the space after it, so replacing a match strips the number cleanly.
//
// Three places need this and had drifted into two literals: docSplit decides
// whether a Word-numbered claim already carries a number in its text, and the
// .docx writer both strips a synthesized number before writing back and decides
// whether an exported line is a claim at all. They must agree exactly — a line
// docSplit considers already-numbered but the writer does not comes back from
// Word with two numbers in front of it.
export const CLAIM_NUM_PREFIX_RE = /^\s*\d{1,4}\s*[.)]\s*/;

/** Does this line open with a claim number? */
export const startsWithClaimNumber = (line: string) => CLAIM_NUM_PREFIX_RE.test(String(line));

/** The line without its leading claim number (unchanged if it has none). */
export const stripClaimNumber = (line: string) => String(line).replace(CLAIM_NUM_PREFIX_RE, '');

// A numeric token that starts a line and is followed by '.' or ')' → claim number.
// Claim numbers are Arabic; a line-leading Roman step (e.g. "I.") is not one.
export function isClaimNumber(text: string, tok: Token): boolean {
  if (!/^\d/.test(tok.word)) return false;
  const after = text[tok.end];
  if (after !== '.' && after !== ')') return false;
  let k = tok.start - 1;
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
  return k < 0 || text[k] === '\n' || text[k] === '\r';
}
