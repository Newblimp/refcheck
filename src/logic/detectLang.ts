// ── LANGUAGE DETECTION ───────────────────────────────────────────────────────
// Primary signal is the section headings: a "Patentansprüche" heading *is* the
// German signal, and it is far more reliable than counting words. Stopword
// scoring only runs when no heading matched at all.
//
// The German word list is reused from constants.js rather than duplicated — one
// place to extend when another language is added.

import { DE_ART, EXCL } from './constants.ts';
import type { Lang } from './constants.ts';
import { tokenize } from './tokenize.ts';

// Unambiguously German function words drawn from the existing German half of
// EXCL, minus the ones that are also English words ("in", "an", "am", "die"…
// would all fire on English text).
const EN_COLLIDING = new Set([
  'in',
  'an',
  'am',
  'die',
  'der',
  'was',
  'so',
  'bei',
  'is',
  'hat',
  'a',
]);
const DE_WORDS = new Set(
  [...DE_ART, ...EXCL].filter((w) => /^[a-zäöüß]+$/.test(w) && !EN_COLLIDING.has(w))
);
// A small English counterweight so a German-looking but English document (lots
// of "der"-free prose) still scores correctly.
const EN_WORDS = new Set([
  'the',
  'of',
  'and',
  'is',
  'are',
  'to',
  'with',
  'from',
  'wherein',
  'said',
  'comprising',
  'having',
  'which',
  'that',
  'for',
  'according',
  'claim',
  'shown',
]);

// Characters that occur in German but not English.
const UMLAUTS = new Set([...'äöüßÄÖÜ']);

/** Score text as English or German by function-word frequency. */
export function detectLangFromText(text: string): Lang {
  if (!text) return 'en';
  // Characters that only occur in German carry a lot of signal on their own.
  // Counted with a loop rather than text.match(…).length, which materialised an
  // array holding every umlaut in the document just to read its size.
  let umlauts = 0;
  for (let i = 0; i < text.length; i++) if (UMLAUTS.has(text[i] ?? '')) umlauts++;
  let de = umlauts * 2,
    en = 0;
  for (const tok of tokenize(text)) {
    const w = tok.word.toLowerCase();
    if (DE_WORDS.has(w)) de++;
    if (EN_WORDS.has(w)) en++;
  }
  return de > en ? 'de' : 'en';
}

/** Where the language came from — reported in the import banner. */
export type LangSource = 'headings' | 'text';

/**
 * Language for an imported document: heading-derived first, text second.
 * @param split Result of splitPatentDoc (only its `lang` is read)
 * @param text  Fallback body text
 */
export function detectLang(
  split: { lang: Lang | null } | null | undefined,
  text: string
): { lang: Lang; from: LangSource } {
  if (split?.lang) return { lang: split.lang, from: 'headings' };
  return { lang: detectLangFromText(text), from: 'text' };
}
