import { disKey } from '../logic/constants.js';

// ── CLAIM-DEPENDENCY CARD ───────────────────────────────────────────────────
// A claim referencing a nonexistent claim, a later claim, or itself.
export function DepCard({ de, focused, t, dis, onFocus, onDismiss }) {
  const key = disKey.dep(de.key);
  const isDis = dis.has(key);
  const msg = de.type === 'missing' ? t.depMissing(de.claim, de.ref)
    : de.type === 'self' ? t.depSelf(de.claim)
    : t.depForward(de.claim, de.ref);
  return (
    <div className={`bare-card${focused ? ' focused' : ''}`} onClick={() => onFocus(de)}>
      <div className="sc-row">
        <span className={`badge ${isDis ? 'dim' : 'warn'}`} style={{ minWidth: 36, fontSize: '12px', background: 'var(--dep-bg)', color: 'var(--dep)' }}>↷</span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>{msg}</div>
        </span>
        <button className="dis-btn" onClick={e => { e.stopPropagation(); onDismiss(key); }}>
          {isDis ? '↩' : '×'}
        </button>
      </div>
    </div>
  );
}
