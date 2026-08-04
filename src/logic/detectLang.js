// ── LANGUAGE DETECTION ───────────────────────────────────────────────────────
// Primary signal is the section headings: a "Patentansprüche" heading *is* the
// German signal, and it is far more reliable than counting words. Stopword
// scoring only runs when no heading matched at all.
//
// The German word list is reused from constants.js rather than duplicated — one
// place to extend when another language is added.

import { DE_ART, EXCL } from './constants.js';
import { tokenize } from './tokenize.js';

// Unambiguously German function words drawn from the existing German half of
// EXCL, minus the ones that are also English words ("in", "an", "am", "die"…
// would all fire on English text).
const EN_COLLIDING = new Set(['in', 'an', 'am', 'die', 'der', 'was', 'so', 'bei', 'is', 'hat', 'a']);
const DE_WORDS = new Set(
  [...DE_ART, ...EXCL].filter(w => /^[a-zäöüß]+$/.test(w) && !EN_COLLIDING.has(w))
);
// A small English counterweight so a German-looking but English document (lots
// of "der"-free prose) still scores correctly.
const EN_WORDS = new Set([
  'the', 'of', 'and', 'is', 'are', 'to', 'with', 'from', 'wherein', 'said',
  'comprising', 'having', 'which', 'that', 'for', 'according', 'claim', 'shown',
]);

/**
 * Score text as English or German by function-word frequency.
 * @param {string} text
 * @returns {'en'|'de'}
 */
export function detectLangFromText(text) {
  if (!text) return 'en';
  // Characters that only occur in German carry a lot of signal on their own.
  const umlauts = (text.match(/[äöüßÄÖÜ]/g) || []).length;
  let de = umlauts * 2, en = 0;
  for (const tok of tokenize(text)) {
    const w = tok.word.toLowerCase();
    if (DE_WORDS.has(w)) de++;
    if (EN_WORDS.has(w)) en++;
  }
  return de > en ? 'de' : 'en';
}

/**
 * Language for an imported document: heading-derived first, text second.
 * @param {{lang: 'en'|'de'|null}} split  Result of splitPatentDoc
 * @param {string} text                   Fallback body text
 * @returns {{lang: 'en'|'de', from: 'headings'|'text'}}
 */
export function detectLang(split, text) {
  if (split?.lang) return { lang: split.lang, from: 'headings' };
  return { lang: detectLangFromText(text), from: 'text' };
}
