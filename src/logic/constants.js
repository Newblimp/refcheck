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
  'figur', 'abbildung', 'anspruch', 'ansprüche', 'absatz', 'seite', 'abschnitt', 'schritt',
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

// A numeric token that starts a line and is followed by '.' or ')' → claim number
export function isClaimNumber(text, tok) {
  const after = text[tok.end];
  if (after !== '.' && after !== ')') return false;
  let k = tok.start - 1;
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--;
  return k < 0 || text[k] === '\n' || text[k] === '\r';
}
