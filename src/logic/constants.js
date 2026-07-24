// ── CONSTANTS ──────────────────────────────────────────────────────────────
// Words that, when they precede a number, should NOT be treated as the term for
// that reference sign (articles, prepositions, cross-reference words, etc.).
export const EXCL = new Set([
  'figure', 'figures', 'fig', 'figs', 'claim', 'claims', 'paragraph', 'page', 'section',
  'table', 'equation', 'reference', 'numeral', 'number', 'no', 'nr', 'see', 'note',
  'wherein', 'whereby', 'comprising', 'having', 'including', 'being', 'said', 'respective',
  'at', 'in', 'of', 'on', 'to', 'by', 'as', 'an', 'a', 'the', 'with', 'from', 'via', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'that', 'this', 'these', 'those',
  'such', 'each', 'least', 'more', 'less', 'than', 'about', 'between', 'through', 'into',
  'according', 'further', 'also', 'only', 'each', 'any', 'all', 'both',
  // German
  'figur', 'figuren', 'abbildung', 'abbildungen', 'abb', 'anspruch', 'ansprüche', 'absatz', 'seite', 'abschnitt', 'schritt',
  'tabelle', 'bezugszeichen', 'ziffer', 'wobei', 'umfassend', 'aufweisend', 'gemäß',
  'bei', 'nach', 'vor', 'über', 'unter', 'durch', 'für', 'von', 'mit', 'zu', 'an', 'am',
  'im', 'in', 'der', 'die', 'das', 'dem', 'den', 'des', 'ein', 'eine', 'einen', 'einem',
  'eines', 'einer', 'und', 'oder', 'ist', 'sind', 'war', 'waren', 'hat', 'haben', 'sich',
  'auch', 'nur', 'noch', 'bereits', 'dabei', 'hierbei', 'hierdurch', 'hierzu',
]);

export const EN_ART = new Set(['a', 'an', 'the']);
export const DE_ART = new Set(['der', 'die', 'das', 'des', 'dem', 'den', 'ein', 'eine', 'eines', 'einer', 'einem', 'einen']);
export const EN_ORD = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'further', 'other', 'another', 'next', 'upper', 'lower', 'inner', 'outer', 'front', 'rear', 'left', 'right', 'top', 'bottom', 'primary', 'secondary', 'main', 'auxiliary', 'additional']);
export const DE_ORD = new Set(['erste', 'ersten', 'erstem', 'erster', 'erstes', 'zweite', 'zweiten', 'zweitem', 'zweiter', 'zweites', 'dritte', 'dritten', 'vierte', 'vierten', 'weitere', 'weiteren', 'weiterer', 'zusätzliche', 'zusätzlichen', 'primäre', 'primären', 'sekundäre', 'sekundären', 'obere', 'oberen', 'untere', 'unteren', 'innere', 'inneren', 'äußere', 'äußeren', 'vordere', 'vorderen', 'hintere', 'hinteren', 'linke', 'linken', 'rechte', 'rechten', 'andere', 'anderen', 'anderer']);

export const isArt = (w, l) => (l === 'de' ? DE_ART : EN_ART).has(w.toLowerCase());
export const isOrd = (w, l) => (l === 'de' ? DE_ORD : EN_ORD).has(w.toLowerCase());
export const artType = w => ['a', 'an', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen'].includes(w.toLowerCase()) ? 'indef' : 'def';
export const likelySign = s => { const n = parseInt(s, 10); return n >= 1 && n <= 99999; };

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
  "(?=[IVXLCDM])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})(?:\\.\\d{1,3})?";
export const ROMAN_RE_ANCHORED = new RegExp('^(?:' + ROMAN_RE + ')$');

// A token is a sign if it is an Arabic sign (right shape AND numeric value in
// range) OR a Roman-numeral step/substep.
export const isSignToken = s =>
  (SIGN_RE_ANCHORED.test(s) && likelySign(s)) || ROMAN_RE_ANCHORED.test(s);

// Value of a Roman-numeral string (e.g. "XIV" → 14). Assumes a valid numeral.
const ROMAN_VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
export function romanToInt(r) {
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const cur = ROMAN_VAL[r[i]], nxt = ROMAN_VAL[r[i + 1]];
    n += (nxt && cur < nxt) ? -cur : cur;
  }
  return n;
}
// Numeric value of a sign for ordering. Arabic → its integer (parseInt ignores a
// trailing letter/prime). Roman "II" → 2; a Roman substep "II.3" → 2 + 3/1000 so
// substeps cluster right after their parent step and before the next one.
export function signVal(s) {
  const m = /^([IVXLCDM]+)(?:\.(\d+))?$/.exec(s);
  if (m) return romanToInt(m[1]) + (m[2] ? parseInt(m[2], 10) / 1000 : 0);
  return parseInt(s, 10);
}
// Order signs: all Arabic signs first (by value, then suffix: 10 < 10' < 10a < 12),
// then all Roman steps grouped at the end (I < I.1 < II) — Arabic and Roman are
// never interleaved. Plain `+a-+b` yields NaN for primed/lettered/Roman signs,
// so always sort through this.
export const compareSigns = (a, b) => {
  const ra = ROMAN_RE_ANCHORED.test(a), rb = ROMAN_RE_ANCHORED.test(b);
  if (ra !== rb) return ra ? 1 : -1;
  return (signVal(a) - signVal(b)) || a.localeCompare(b);
};

// ── DISMISSAL KEYS ───────────────────────────────────────────────────────────
// Single place that defines the "<prefix>:<id>" scheme used to identify a
// dismissed error. Shared by App, getAllErrors, buildHtml and the sidebar
// cards — never assemble these strings by hand.
export const disKey = {
  sign: sign => 's:' + sign,      // id: the sign itself
  art: termStem => 'a:' + termStem, // id: the term stem
  bare: termStem => 'b:' + termStem, // id: the term stem
  num: key => 'n:' + key,         // id: numError.key (value#ordinal — edit-stable)
  dep: key => 'd:' + key,         // id: depError.key (claim>ref#ordinal)
};

// A numeric token that starts a line and is followed by '.' or ')' → claim number.
// Claim numbers are Arabic; a line-leading Roman step (e.g. "I.") is not one.
export function isClaimNumber(text, tok) {
  if (!/^\d/.test(tok.word)) return false;
  const after = text[tok.end];
  if (after !== '.' && after !== ')') return false;
  let k = tok.start - 1;
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
  return k < 0 || text[k] === '\n' || text[k] === '\r';
}
