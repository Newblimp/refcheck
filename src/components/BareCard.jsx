import { memo } from 'react';
import { disKey } from '../logic/constants.js';
import { activatable } from './cardProps.js';

// ── BARE-TERM CARD ──────────────────────────────────────────────────────────
function BareCardImpl({ bt, focused, t, dis, onFocus, onDismiss }) {
  const key = disKey.bare(bt.termStem);
  const isDis = dis.has(key);
  return (
    <div className={`bare-card${focused ? ' focused' : ''}`} {...activatable(() => onFocus(bt))}>
      <div className="sc-row">
        <span
          className={`badge ${isDis ? 'dim' : 'warn'}`}
          style={{
            minWidth: 36,
            fontSize: '12px',
            background: 'var(--bare-bg)',
            color: 'var(--bare)',
          }}
        >
          ∅
        </span>
        <span className="sc-main">
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.35 }}>
            {t.bareTerm(bt.term, bt.signs)}
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
export const BareCard = memo(BareCardImpl);
