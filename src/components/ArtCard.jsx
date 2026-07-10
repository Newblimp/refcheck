import { disKey } from '../logic/constants.js';

// ── ARTICLE CARD ────────────────────────────────────────────────────────────
export function ArtCard({ ae, focused, t, dis, onFocus, onDismiss }) {
  const key = disKey.art(ae.termStem);
  const isDis = dis.has(key);
  const msg = ae.errType === 'first-def' ? t.artFD(ae.article) : ae.errType === 'repeat-indef' ? t.artRI(ae.article) : t.artGender(ae.article, ae.prevArt);
  return (
    <div className={`art-card${focused ? ' focused' : ''}`} onClick={() => onFocus(ae)}>
      <div className="sc-row">
        <span className={`badge ${isDis ? 'dim' : 'art'}`} style={{ minWidth: 36, fontSize: '12px' }}>{ae.article}</span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>{msg}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{ae.sign} · {ae.termStem}</div>
        </span>
        <button className="dis-btn" onClick={e => { e.stopPropagation(); onDismiss(key); }}>
          {isDis ? '↩' : '×'}
        </button>
      </div>
    </div>
  );
}
