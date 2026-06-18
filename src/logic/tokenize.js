import { SIGN_RE } from './constants.js';

// ── TOKENIZER ──────────────────────────────────────────────────────────────
// Splits text into word/number tokens, recording each token's character span.
// The number branch is the shared SIGN_RE fragment, so primes/letters that are
// part of a sign (12a, 10', 10′) are captured into a single token.
export function tokenize(text){
  const RE=new RegExp(`(?<![a-zA-ZäöüÄÖÜß\\-\\d])([a-zA-ZäöüÄÖÜß\\-]+|${SIGN_RE})(?![a-zA-ZäöüÄÖÜß\\-\\d])`,'g');
  const toks=[];let m;
  while((m=RE.exec(text))!==null)toks.push({word:m[1],start:m.index,end:m.index+m[1].length});
  return toks;
}
