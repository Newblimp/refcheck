import { useState, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/** How a stored value is turned into a string and back. */
export interface Codec<T> {
  parse: (raw: string) => T;
  stringify: (value: T) => string;
}

export interface PersistOpts {
  /** ms to wait before writing (default 0 = write on the next effect). */
  debounce?: number;
  /** Called when a write throws — quota exceeded, most likely. */
  onError?: (err: unknown, key: string) => void;
}

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
// Without a codec the value is written to localStorage as-is, so it has to be a
// string — the overloads make that a type error rather than a silently stored
// "[object Object]".
export function usePersistentState(
  key: string,
  initial: string,
  codec?: undefined,
  opts?: PersistOpts
): [string, Dispatch<SetStateAction<string>>];
export function usePersistentState<T>(
  key: string,
  initial: T,
  codec: Codec<T>,
  opts?: PersistOpts
): [T, Dispatch<SetStateAction<T>>];
export function usePersistentState<T>(
  key: string,
  initial: T,
  codec?: Codec<T>,
  { debounce = 0, onError }: PersistOpts = {}
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return codec ? codec.parse(raw) : (raw as T);
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
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (Object.is(value, writtenRef.current)) return;
    const write = () => {
      pendingRef.current = null;
      const k = keyRef.current;
      const c = codecRef.current;
      try {
        localStorage.setItem(k, c ? c.stringify(value) : (value as unknown as string));
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

/**
 * JSON codec for a value of type T.
 *
 * A function rather than a constant so each call site names what it is storing:
 * `jsonCodec<Panes>()`. As a single shared constant its type would have to be
 * `Codec<any>`, which would quietly un-type every value that goes through it —
 * and these are exactly the values restored from storage, i.e. the ones whose
 * shape is least under the app's control.
 */
export const jsonCodec = <T>(): Codec<T> => ({
  parse: JSON.parse as (raw: string) => T,
  stringify: JSON.stringify,
});

export const setCodec: Codec<Set<string>> = {
  parse: (raw) => new Set<string>(JSON.parse(raw)),
  stringify: (s) => JSON.stringify([...s]),
};

/** Rejects unknown stored values (e.g. hand-edited storage) in favor of a fallback. */
export const oneOf = <T extends string>(allowed: readonly T[], fallback: T): Codec<T> => ({
  parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : fallback),
  stringify: (v) => v,
});
