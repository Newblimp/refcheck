// ── TOKENIZER ──────────────────────────────────────────────────────────────
// Splits text into word/number tokens, recording each token's character span.
export function tokenize(text){
  const RE=/(?<![a-zA-ZäöüÄÖÜß\-\d])([a-zA-ZäöüÄÖÜß\-]+|\d{1,5}[a-z]?)(?![a-zA-ZäöüÄÖÜß\-\d])/g;
  const toks=[];let m;
  while((m=RE.exec(text))!==null)toks.push({word:m[1],start:m.index,end:m.index+m[1].length});
  return toks;
}
