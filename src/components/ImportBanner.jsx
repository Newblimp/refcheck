// Result line shown after an import.
//
// The import fills both buffers without a confirm step, so this is what makes a
// wrong guess visible and reversible: it states what was detected, warns when a
// heading was missing or claim numbers had to be reconstructed, and offers a
// one-step undo back to the previous buffers.
export function ImportBanner({ report, t, onUndo, onDismiss }) {
  if (!report) return null;
  const { kind, descChars, claimsChars, lang, warnings = [], messageKey } = report;

  // Messages are stored as keys and resolved here, so they always render in the
  // language that is active now — including the one the import itself just set.
  const str = (key, arg) => {
    const v = t[key];
    return typeof v === 'function' ? v(arg) : v;
  };

  return (
    <div className={`imp-banner imp-${kind}`} role="status">
      <span className="imp-main">
        {/* A message key means "this is a stated result" (an import that failed,
            an export that could not be verified). Only a report WITHOUT one is
            the successful-import summary, which is the only thing that has
            character counts to show. */}
        {messageKey ? (
          <strong>{str(messageKey)}</strong>
        ) : (
          <>
            <strong>{t.impDone}</strong>
            <span className="imp-sep">·</span>
            <span className="imp-lang">{lang?.toUpperCase()}</span>
            <span className="imp-sep">·</span>
            <span>{t.impDesc(descChars)}</span>
            <span className="imp-sep">·</span>
            <span>{t.impClaims(claimsChars)}</span>
          </>
        )}
      </span>
      {warnings.length > 0 && (
        <span className="imp-warnings">
          {warnings.map((w, i) => (
            <span key={i}>⚠ {str(w.key, w.arg)}</span>
          ))}
        </span>
      )}
      <span className="imp-actions">
        {onUndo && (
          <button className="restore-btn" onClick={onUndo}>
            ↩ {t.impUndo}
          </button>
        )}
        <button className="imp-x" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </span>
    </div>
  );
}
