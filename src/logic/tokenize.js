import { SIGN_RE, ROMAN_RE } from './constants.js';

// ── TOKENIZER ──────────────────────────────────────────────────────────────
// Splits text into word/number tokens, recording each token's character span.
// The number branch is the shared SIGN_RE fragment, so primes/letters that are
// part of a sign (12a, 10', 10′) are captured into a single token. The ROMAN_RE
// branch comes first so a Roman step/substep (II, IX, I.1) is captured whole
// (dot and Arabic part included); the trailing boundary lets it fall through to
// the word branch when the Roman letters are really the start of a word (In, DC
// vs II — "In" fails the boundary after "I" and is re-matched as one word).
// Compiled once at module load; tokenize() resets lastIndex so the shared /g
// regex is safe across calls.
const TOKEN_RE = new RegExp(
  `(?<![a-zA-ZäöüÄÖÜß\\-\\d])(${ROMAN_RE}|[a-zA-ZäöüÄÖÜß\\-]+|${SIGN_RE})(?![a-zA-ZäöüÄÖÜß\\-\\d])`,
  'g'
);

export function tokenize(text) {
  TOKEN_RE.lastIndex = 0;
  const toks = [];
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null)
    toks.push({ word: m[1], start: m.index, end: m.index + m[1].length });
  return toks;
}
