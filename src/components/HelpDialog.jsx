import { useEffect, useRef } from 'react';
import { HELP } from '../helpText.js';

// ── HELP ────────────────────────────────────────────────────────────────────
// A short usage guide and the keyboard shortcuts. Until this existed the only
// discoverable shortcuts were the two named in the status-bar tooltips.
//
// Reached through LazyHelpDialog, so this module and its strings are a chunk of
// their own. It therefore takes `lang` and reads helpText.js itself rather than
// taking the resolved `t` — passing `t` in would have kept the strings on the
// critical path, which is the entire point of the split.

// The modifier key, written the way the user's machine writes it. Ctrl is
// "Strg" in German, and a Mac shows ⌘ — useHotkeys treats Ctrl and Meta alike,
// so both really do work; only the label differs.
const modLabel = (lang) => {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  return mac ? '⌘' : lang === 'de' ? 'Strg' : 'Ctrl';
};

// One row per binding. Keys are i18n keys so EN and DE share the combos —
// only the descriptions are translated.
export const BINDINGS = [
  { keys: ['mod', '↓'], desc: 'keyNextErr' },
  { keys: ['mod', '↑'], desc: 'keyPrevErr' },
  { keys: ['mod', 'Shift', '↓'], desc: 'keyNextTerm' },
  { keys: ['mod', 'Shift', '↑'], desc: 'keyPrevTerm' },
  { keys: ['mod', 'F'], desc: 'keySearch' },
  { keys: ['mod', 'M'], desc: 'keyMode' },
  { keys: ['mod', 'B'], desc: 'keyRefPane' },
  { keys: ['mod', 'Shift', 'B'], desc: 'keySignPane' },
  { keys: ['mod', 'O'], desc: 'keyImport' },
  { keys: ['mod', 'S'], desc: 'keyExport' },
  { keys: ['mod', '?'], desc: 'keyHelp' },
  { keys: ['Esc'], desc: 'keyEsc' },
];

export function HelpDialog({ lang, onClose }) {
  const t = HELP[lang] || HELP.en;
  const boxRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Stop App's own Escape binding from also firing.
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the dialog. Nothing else in the app traps focus, but a
      // modal that lets focus wander behind it is worse than no modal: the
      // editor is still there, and typing would go into it unseen.
      const items = [...(boxRef.current?.querySelectorAll('button') || [])];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      returnFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const mod = modLabel(lang);

  return (
    <div className="help-scrim" onClick={onClose}>
      <div
        className="help-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-hdr">
          <strong id="help-title">{t.helpTitle}</strong>
          <button className="imp-x" onClick={onClose} aria-label={t.helpClose} ref={closeRef}>
            ×
          </button>
        </div>

        <h3 className="help-sub">{t.helpGuideTitle}</h3>
        <ul className="help-guide">
          {t.helpGuide.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>

        <h3 className="help-sub">{t.helpKeysTitle}</h3>
        <table className="help-keys">
          <tbody>
            {BINDINGS.map((b) => (
              <tr key={b.desc}>
                <td>
                  {b.keys.map((k, i) => (
                    <span key={i}>
                      {i > 0 && <span className="help-plus">+</span>}
                      <kbd>{k === 'mod' ? mod : k}</kbd>
                    </span>
                  ))}
                </td>
                <td>{t[b.desc]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
