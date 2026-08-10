import { memo } from 'react';
import { activatable } from './cardProps.js';

// ── ERROR CARD ──────────────────────────────────────────────────────────────
// One card for all four non-sign error categories, driven by its ERROR_KINDS
// row (logic/errorKinds.js).
//
// This replaces ArtCard, BareCard, NumCard and DepCard, which were the same
// component four times over: same wrapper, same badge, same message line, same
// dismiss button, differing only in a glyph, a colour token and which i18n
// function formatted the message — all three of which the row already names.
//
// The colour arrives as two CSS custom properties rather than as class names, so
// a new category needs no new rule in styles.css: it defines --<color> and
// --<color>-bg like every other category already does, and the card picks them
// up. SignCard stays its own component — it carries severity, term chips,
// multi-word badges and per-term conflict notes, none of which fit here.
function ErrorCardImpl({ kind, item, focused, t, dis, onFocus, onDismiss }) {
  const key = kind.disKey(item);
  const isDis = dis.has(key);
  const sub = kind.sub ? kind.sub(item) : null;
  return (
    <div
      className={`err-card${focused ? ' focused' : ''}${isDis ? ' dis' : ''}`}
      style={{ '--kind': `var(--${kind.color})`, '--kind-bg': `var(--${kind.color}-bg)` }}
      {...activatable(() => onFocus(kind.id, item))}
    >
      <div className="sc-row">
        <span className="badge">{kind.badge(item)}</span>
        <span className="sc-main">
          <div className="err-msg">{kind.message(item, t)}</div>
          {sub && <div className="err-sub">{sub}</div>}
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
export const ErrorCard = memo(ErrorCardImpl);
