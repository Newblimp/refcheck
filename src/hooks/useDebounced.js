import { useState, useEffect } from 'react';

// ── useDebounced ─────────────────────────────────────────────────────────────
// Returns a copy of `value` that only updates once it has stopped changing for
// `delay` ms. A delay of 0 updates synchronously on the next tick. Used to keep
// the textarea responsive while deferring the expensive extractData pass on
// large documents.
export function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delay <= 0) { setDebounced(value); return; }
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
