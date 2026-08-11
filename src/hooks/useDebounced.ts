import { useEffect, useReducer, useRef } from 'react';

// ── useDebounced ─────────────────────────────────────────────────────────────
// Returns a copy of `value` that only updates once it has stopped changing for
// `delay` ms. With delay <= 0 the value passes through synchronously with zero
// extra renders (the previous implementation round-tripped through state, which
// cost one wasted render per keystroke on every small document). The latest
// value is kept in a ref even while delay is 0, so crossing the size threshold
// into debounced mode never exposes a stale value.
//
// `initial` opts the FIRST render out of that pass-through, and exists for the
// boot path specifically. A restored session starts with its buffers already
// full, so the very first render extracted them synchronously — measured at
// ~77 ms per buffer on a 112 KB document, twice over, before anything at all was
// painted. With `initial` the first render sees that placeholder instead, the
// shell and the textarea (which reads the raw value, not this one) paint
// immediately, and the real value is handed over from an effect — i.e. after
// paint rather than before it.
//
// It is not the debounce timeout: waiting the full delay to show a restored
// document would trade one stall for another. The handover happens on the first
// effect, one frame later.
//
// Deferral applies only when `delay > 0` at mount, which is the caller's own
// "this document is big enough to be slow" test. A small document extracts in
// single-digit milliseconds, and deferring there would cost a frame of missing
// highlights to save nothing.
//
/**
 * @param delay   ms of quiet before `value` is adopted; <= 0 passes through
 * @param initial what the first render returns instead of `value`
 */
export function useDebounced<T>(value: T, delay: number, initial?: T): T {
  // The `void` action parameter is what lets `force()` be called with no
  // argument: useReducer's dispatch takes the reducer's action type, and a
  // parameter typed `void` may be omitted at the call site.
  const [, force] = useReducer((c: number, _action: void) => c + 1, 0);
  const deferring = useRef(initial !== undefined && delay > 0);
  // `deferring` is only true when `initial` was supplied, so the cast is the
  // invariant on the line above written down.
  const ref = useRef<T>(deferring.current ? (initial as T) : value);

  useEffect(() => {
    if (deferring.current) {
      // First effect after a deferred mount: the browser has painted, so the
      // real value can be adopted now without the debounce wait.
      deferring.current = false;
      ref.current = value;
      force();
      return;
    }
    if (delay <= 0) return;
    const id = setTimeout(() => {
      ref.current = value;
      force();
    }, delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  if (!deferring.current && delay <= 0) ref.current = value;
  return ref.current;
}
