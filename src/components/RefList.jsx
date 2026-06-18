import { useState, useMemo } from 'react';
import { buildRefList, toPlainText } from '../logic/reflist.js';

// ── REFERENCE NUMERAL LIST ───────────────────────────────────────────────────
// Collapsible sidebar section showing the sign → term table for the active
// buffer, with copy-to-clipboard (plain text) for pasting into a draft.
export function RefList({ signData, termData, t }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => buildRefList(signData, termData), [signData, termData]);
  if (rows.length === 0) return null;

  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard;
  function copy(e) {
    e.stopPropagation();
    if (!canCopy) return;
    navigator.clipboard.writeText(toPlainText(rows)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="reflist-section">
      <div className="reflist-hdr" onClick={() => setOpen(o => !o)}>
        <span className="sec-lbl" style={{ padding: 0, color: 'var(--text-muted)' }}>
          {open ? '▾' : '▸'} ⌗ {t.refListLbl} ({rows.length})
        </span>
        {canCopy && open && (
          <button className="restore-btn" onClick={copy}>
            {copied ? t.refListCopied : t.refListCopy}
          </button>
        )}
      </div>
      {open && (
        <table className="reflist-table">
          <thead>
            <tr><th>{t.refListColSign}</th><th>{t.refListColTerm}</th><th>{t.refListColCount}</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sign}>
                <td className="rl-sign">{r.sign}</td>
                <td className="rl-term">{r.term}</td>
                <td className="rl-count">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
