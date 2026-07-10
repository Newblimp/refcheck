import { useState, useEffect } from 'react';

// ── usePersistentState ───────────────────────────────────────────────────────
// useState that initializes from localStorage and writes back on every change.
// All storage access is wrapped in try/catch so private-mode / quota failures
// degrade to plain in-memory state. Without a codec the value is stored as-is
// (strings); pass a codec for anything else.
export function usePersistentState(key, initial, codec) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return codec ? codec.parse(raw) : raw;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, codec ? codec.stringify(value) : value); } catch {}
  }, [value]);
  return [value, setValue];
}

export const jsonCodec = { parse: JSON.parse, stringify: JSON.stringify };
export const setCodec = { parse: raw => new Set(JSON.parse(raw)), stringify: s => JSON.stringify([...s]) };
// Rejects unknown stored values (e.g. hand-edited storage) in favor of a fallback.
export const oneOf = (allowed, fallback) => ({
  parse: raw => (allowed.includes(raw) ? raw : fallback),
  stringify: v => v,
});
