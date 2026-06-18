// ── BARE-TERM CARD ──────────────────────────────────────────────────────────
export function BareCard({ bt, focused, t, dis, onFocus, onDismiss }) {
  const isDis = dis.has('b:' + bt.termStem);
  return (
    <div className={`bare-card${focused ? ' focused' : ''}`} onClick={() => onFocus('bare:' + bt.termStart, bt.termStart, bt.termEnd)}>
      <div className="sc-row">
        <span className={`badge ${isDis ? 'dim' : 'warn'}`} style={{ minWidth: 36, fontSize: '12px', background: 'var(--bare-bg)', color: 'var(--bare)' }}>∅</span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>{t.bareTerm(bt.term, bt.signs)}</div>
        </span>
        <button className="dis-btn" onClick={e => { e.stopPropagation(); onDismiss('b:' + bt.termStem); }}>
          {isDis ? '↩' : '×'}
        </button>
      </div>
    </div>
  );
}
