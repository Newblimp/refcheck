// ── BEE TRIGGER ──────────────────────────────────────────────────────────────
// Six lines, in a module of their own, for a loading reason: useBee runs this on
// every settled keystroke and so must be eager, while the flight model it used
// to sit beside (beeFlight.js) is only reached through the lazily-imported Bee
// component. One import of this function from the eager side was enough to pull
// the whole 1.5 KB motion model onto the critical path for an easter egg most
// sessions never trigger.
//
// So: keep them apart, and do not re-export this from beeFlight.js — a
// convenience re-export would restore exactly the edge that cost the bytes.

/**
 * How many times the trigger word appears (the typed trigger).
 *
 * "bee" always counts; "Biene"/"Bienen" counts as well when German is the
 * active language. Word boundaries keep compounds out — "beetle" and
 * "Bienenstock" are not the user asking for a bee.
 *
 * @param {string} text
 * @param {'en'|'de'} [lang]
 */
export function countBees(text, lang) {
  if (!text) return 0;
  const s = String(text);
  let n = (s.match(/\bbees?\b/gi) || []).length;
  if (lang === 'de') n += (s.match(/\bbienen?\b/gi) || []).length;
  return n;
}
