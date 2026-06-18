// ── NUMBERING CARD ──────────────────────────────────────────────────────────
export function NumCard({ ne, focused, t, dis, onFocus, onDismiss }) {
  const isDis = dis.has('n:' + ne.start);
  return (
    <div className={`bare-card${focused ? ' focused' : ''}`} onClick={() => onFocus('num:' + ne.start, ne.start, ne.end)}>
      <div className="sc-row">
        <span className={`badge ${isDis ? 'dim' : 'warn'}`} style={{ minWidth: 36, fontSize: '12px', background: 'var(--num-bg)', color: 'var(--num)' }}>⌗</span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>{t.numberingErr(ne.value, ne.expected)}</div>
        </span>
        <button className="dis-btn" onClick={e => { e.stopPropagation(); onDismiss('n:' + ne.start); }}>
          {isDis ? '↩' : '×'}
        </button>
      </div>
    </div>
  );
}
