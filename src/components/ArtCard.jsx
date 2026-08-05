import { memo } from 'react';
import { disKey } from '../logic/constants.js';
import { activatable } from './cardProps.js';

// ── ARTICLE CARD ────────────────────────────────────────────────────────────
function ArtCardImpl({ ae, focused, t, dis, onFocus, onDismiss }) {
  const key = disKey.art(ae.termStem);
  const isDis = dis.has(key);
  const msg =
    ae.errType === 'first-def'
      ? t.artFD(ae.article)
      : ae.errType === 'repeat-indef'
        ? t.artRI(ae.article)
        : t.artGender(ae.article, ae.prevArt);
  return (
    <div className={`art-card${focused ? ' focused' : ''}`} {...activatable(() => onFocus(ae))}>
      <div className="sc-row">
        <span
          className={`badge ${isDis ? 'dim' : 'art'}`}
          style={{ minWidth: 36, fontSize: '12px' }}
        >
          {ae.article}
        </span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>
            {msg}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-dim)',
              marginTop: 2,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {ae.sign} · {ae.termStem}
          </div>
        </span>
        <button
          className="dis-btn"
          aria-label={isDis ? t.restoreOne : t.dismissOne}
          title={isDis ? t.restoreOne : t.dismissOne}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(key);
          }}
        >
          {isDis ? '↩' : '×'}
        </button>
      </div>
    </div>
  );
}

// memo: the sidebar re-renders on every keystroke, hover and error-nav step,
// but a card's props only change when its own error does.
export const ArtCard = memo(ArtCardImpl);
