import { useEffect, useReducer, useRef } from 'react';

// ── useDebounced ─────────────────────────────────────────────────────────────
// Returns a copy of `value` that only updates once it has stopped changing for
// `delay` ms. With delay <= 0 the value passes through synchronously with zero
// extra renders (the previous implementation round-tripped through state, which
// cost one wasted render per keystroke on every small document). The latest
// value is kept in a ref even while delay is 0, so crossing the size threshold
// into debounced mode never exposes a stale value.
export function useDebounced(value, delay) {
  const [, force] = useReducer(c => c + 1, 0);
  const ref = useRef(value);
  useEffect(() => {
    if (delay <= 0) return;
    const id = setTimeout(() => { ref.current = value; force(); }, delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  if (delay <= 0) ref.current = value;
  return ref.current;
}
