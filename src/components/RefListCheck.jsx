import { memo } from 'react';

// ── REFERENCE-LIST CHECK ────────────────────────────────────────────────────
// Paste the draft's own "List of Reference Signs" / "Bezugszeichenliste" and
// see where it has drifted from the text. A .docx import fills this in
// automatically — splitPatentDoc already locates that section.
function RefListCheckImpl({ value, onChange, result, t }) {
  return (
    <div className="rlc-body">
      <textarea
        className="rlc-in"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.reconcilePh}
        aria-label={t.reconcileLbl}
        rows={4}
        spellCheck={false}
      />
      {result && !result.hasAny && <div className="rlc-ok">✓ {t.reconcileOk(result.matched)}</div>}
      {result?.termMismatch.map(({ sign, listTerm, textTerm }) => (
        <div className="orphan-card" key={'tm' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">{t.refTermMismatch(listTerm, textTerm)}</span>
        </div>
      ))}
      {result?.duplicates.map(({ sign, terms }) => (
        <div className="orphan-card" key={'dup' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">{t.refDuplicate(terms)}</span>
        </div>
      ))}
      {result?.listedNotUsed.map(({ sign, term }) => (
        <div className="orphan-card" key={'lnu' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">
            "{term}" — {t.listedNotUsed}
          </span>
        </div>
      ))}
      {result?.usedNotListed.map(({ sign, term }) => (
        <div className="orphan-card" key={'unl' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">
            "{term}" — {t.usedNotListed}
          </span>
        </div>
      ))}
    </div>
  );
}

export const RefListCheck = memo(RefListCheckImpl);
