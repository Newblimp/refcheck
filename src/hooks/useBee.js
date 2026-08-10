import { useCallback, useEffect, useRef, useState } from 'react';
import { countBees } from '../logic/beeFlight.js';
import { useDebounced } from './useDebounced.js';

// Decides WHEN a bee shows up. Two triggers:
//   • a rare random chance, tuned to roughly one bee every MEAN_MS
//   • typing the word "bee" into either buffer
//
// The random draw is a Bernoulli trial per tick with p = TICK/MEAN, which makes
// the wait time geometric — memoryless, so "about every five minutes" holds no
// matter when you started looking, rather than being a fixed countdown.

const TICK_MS = 10_000;
const MEAN_MS = 5 * 60_000;
const MAX_BEES = 5;
const SETTLE_MS = 400; // pause after typing before the trigger word is counted

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {string} watchText Text whose "bee" count triggers a flight. Pass BOTH
 *   buffers concatenated, so switching modes never looks like new text.
 * @param {'en'|'de'} [lang] Active language; in German "Biene" triggers too.
 * @returns {[number[], (id:number)=>void]} ids of the bees in flight, and the
 *   callback a bee calls when it has left the screen.
 */
export function useBee(watchText, lang) {
  const [bees, setBees] = useState([]);
  const nextId = useRef(1);

  const add = useCallback(() => {
    setBees((list) => (list.length >= MAX_BEES ? list : [...list, nextId.current++]));
  }, []);
  // Stable identity: Bee holds this for the lifetime of its flight.
  const done = useCallback((id) => setBees((list) => list.filter((x) => x !== id)), []);

  // Random appearances. Unrequested motion, so this one honours the OS setting.
  useEffect(() => {
    if (typeof window === 'undefined' || prefersReducedMotion()) return;
    const id = setInterval(() => {
      if (Math.random() < TICK_MS / MEAN_MS) add();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [add]);

  // Typing "bee". Fires when the count RISES, so typing it twice summons two
  // bees, while merely restoring a saved buffer that already contains the word
  // summons none.
  //
  // Deliberately NOT gated on prefers-reduced-motion: this is an explicit,
  // by-name request from the user, and silently doing nothing just looks broken.
  // The setting still suppresses the random appearances above, which is the
  // motion someone asking to reduce motion actually did not ask for.
  // Count only settled text. Mid-word keystrokes are momentarily complete words
  // — typing "Bienenstock" passes through "Biene", and "beetle" through "bee" —
  // so sampling every keystroke summons bees for words that merely start alike.
  // Waiting for a pause means only what the user actually left standing counts.
  const settled = useDebounced(watchText, SETTLE_MS);

  const seen = useRef(null);
  const prevLang = useRef(lang);
  useEffect(() => {
    const n = countBees(settled, lang);
    // Switching language changes which words count, so re-baseline instead of
    // reading the jump as a request — flipping to German with "Biene" already
    // in the buffer (or a .docx import, which changes text and language at
    // once) must not summon a bee on its own.
    const langChanged = prevLang.current !== lang;
    prevLang.current = lang;
    if (seen.current === null || langChanged) {
      seen.current = n;
      return;
    }
    if (n > seen.current) add();
    seen.current = n;
  }, [settled, lang, add]);

  return [bees, done];
}
