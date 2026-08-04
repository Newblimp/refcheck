import { useCallback, useEffect, useRef, useState } from 'react';
import { countBees } from '../logic/beeFlight.js';

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

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {string} watchText Text whose "bee" count triggers a flight. Pass BOTH
 *   buffers concatenated, so switching modes never looks like new text.
 * @returns {[number[], (id:number)=>void]} ids of the bees in flight, and the
 *   callback a bee calls when it has left the screen.
 */
export function useBee(watchText) {
  const [bees, setBees] = useState([]);
  const nextId = useRef(1);

  const add = useCallback(() => {
    setBees(list => (list.length >= MAX_BEES ? list : [...list, nextId.current++]));
  }, []);
  // Stable identity: Bee holds this for the lifetime of its flight.
  const done = useCallback(id => setBees(list => list.filter(x => x !== id)), []);

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
  const seen = useRef(null);
  useEffect(() => {
    const n = countBees(watchText);
    if (seen.current === null) { seen.current = n; return; }
    if (n > seen.current) add();
    seen.current = n;
  }, [watchText, add]);

  return [bees, done];
}
