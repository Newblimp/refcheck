import { useState, useEffect, useRef } from 'react';

// ── usePersistentState ───────────────────────────────────────────────────────
// useState that initializes from localStorage and writes back on change.
// All storage access is wrapped in try/catch so private-mode failures degrade to
// plain in-memory state. Without a codec the value is stored as-is (strings);
// pass a codec for anything else.
//
// Options:
//   debounce  ms to wait before writing (default 0 = write on the next effect).
//             The text buffers pass a delay because writing is synchronous: on a
//             200KB description an undebounced write serialised and stored 200KB
//             on *every keystroke*, which was a bigger typing-latency source than
//             extraction — and unlike extraction it was not covered by the
//             editor's own debounce. A pending write is always flushed before the
//             page is hidden or unloaded, so nothing is lost by deferring it.
//   onError   called when a write throws (quota exceeded, most likely). Without
//             this the failure was swallowed and the user silently lost their
//             work on the next refresh.
export function usePersistentState(key, initial, codec, { debounce = 0, onError } = {}) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return codec ? codec.parse(raw) : raw;
    } catch {
      return initial;
    }
  });

  // Held in refs so the write effect can depend on `value` alone: `codec` and
  // `onError` are fresh identities on most renders and would otherwise re-arm
  // the debounce timer on every render rather than every change.
  const codecRef = useRef(codec);
  codecRef.current = codec;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const keyRef = useRef(key);
  keyRef.current = key;

  // The value currently written to storage, so the mount-time effect does not
  // immediately rewrite what it just read back.
  const writtenRef = useRef(value);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (Object.is(value, writtenRef.current)) return;
    const write = () => {
      pendingRef.current = null;
      const k = keyRef.current;
      const c = codecRef.current;
      try {
        localStorage.setItem(k, c ? c.stringify(value) : value);
        writtenRef.current = value;
      } catch (err) {
        onErrorRef.current?.(err, k);
      }
    };
    if (debounce <= 0) {
      write();
      return;
    }
    pendingRef.current = write;
    const id = setTimeout(write, debounce);
    return () => clearTimeout(id);
  }, [value, debounce]);

  // A debounced write must not be lost when the tab is closed or backgrounded.
  // pagehide covers navigation and mobile app-switching; visibilitychange covers
  // the case where the tab is merely hidden and later discarded by the browser.
  useEffect(() => {
    if (debounce <= 0) return;
    const flush = () => pendingRef.current?.();
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [debounce]);

  return [value, setValue];
}

export const jsonCodec = { parse: JSON.parse, stringify: JSON.stringify };
export const setCodec = {
  parse: (raw) => new Set(JSON.parse(raw)),
  stringify: (s) => JSON.stringify([...s]),
};
// Rejects unknown stored values (e.g. hand-edited storage) in favor of a fallback.
export const oneOf = (allowed, fallback) => ({
  parse: (raw) => (allowed.includes(raw) ? raw : fallback),
  stringify: (v) => v,
});
