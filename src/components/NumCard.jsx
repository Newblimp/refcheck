import { disKey } from '../logic/constants.js';

// ── NUMBERING CARD ──────────────────────────────────────────────────────────
export function NumCard({ ne, focused, t, dis, onFocus, onDismiss }) {
  const key = disKey.num(ne.key);
  const isDis = dis.has(key);
  return (
    <div className={`bare-card${focused ? ' focused' : ''}`} onClick={() => onFocus(ne)}>
      <div className="sc-row">
        <span className={`badge ${isDis ? 'dim' : 'warn'}`} style={{ minWidth: 36, fontSize: '12px', background: 'var(--num-bg)', color: 'var(--num)' }}>⌗</span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>{t.numberingErr(ne.value, ne.expected)}</div>
        </span>
        <button className="dis-btn" onClick={e => { e.stopPropagation(); onDismiss(key); }}>
          {isDis ? '↩' : '×'}
        </button>
      </div>
    </div>
  );
}
