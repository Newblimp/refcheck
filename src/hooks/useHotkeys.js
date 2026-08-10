import { useEffect, useRef } from 'react';

// ── useHotkeys ───────────────────────────────────────────────────────────────
// Window-level keyboard shortcuts.
//
// Bindings are given as a map of descriptor → handler, e.g.
//   { 'mod+[': prev, 'mod+]': next, '/': focusSearch }
// where "mod" is Ctrl on Windows/Linux and Cmd on macOS.
//
// Bindings without a modifier are suppressed while the user is typing in a
// field — the editor is a <textarea> that holds focus almost all the time, so an
// unqualified "/" binding would otherwise make the app impossible to type in.
// Modified bindings still fire there, which is the point of Ctrl+[ / Ctrl+].

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/** Normalize an event into the same descriptor shape the bindings use. */
function descriptorFor(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join('+');
}

/**
 * @param {Object<string, (e: KeyboardEvent) => void>} bindings
 * @param {boolean} [enabled=true]
 */
export function useHotkeys(bindings, enabled = true) {
  // Held in a ref so a fresh bindings object per render does not re-bind the
  // listener on every keystroke.
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKey = (e) => {
      const handler = ref.current[descriptorFor(e)];
      if (!handler) return;
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (bare && isTypingTarget(e.target)) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
