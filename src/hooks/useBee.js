import { useEffect, useRef, useState } from 'react';
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

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {string} watchText Text whose "bee" count triggers a flight. Pass BOTH
 *   buffers concatenated, so switching modes never looks like new text.
 * @returns {[boolean, () => void]} whether a bee is flying, and a done callback
 */
export function useBee(watchText) {
  const [flying, setFlying] = useState(false);
  const flyingRef = useRef(false);
  flyingRef.current = flying;

  // Random appearances.
  useEffect(() => {
    if (typeof window === 'undefined' || prefersReducedMotion()) return;
    const id = setInterval(() => {
      if (!flyingRef.current && Math.random() < TICK_MS / MEAN_MS) setFlying(true);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Typing "bee". Triggers when the count RISES, so typing it a second time
  // summons a second bee, while restoring a saved buffer that already contains
  // the word on first load does not.
  const seen = useRef(null);
  useEffect(() => {
    const n = countBees(watchText);
    if (seen.current === null) { seen.current = n; return; }
    if (n > seen.current && !prefersReducedMotion()) setFlying(true);
    seen.current = n;
  }, [watchText]);

  return [flying, () => setFlying(false)];
}
