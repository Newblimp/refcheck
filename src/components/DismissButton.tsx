import type { Strings } from '../i18n.ts';

export interface DismissButtonProps {
  /** Whether this error is currently dismissed — flips the glyph and the label. */
  dismissed: boolean;
  /** Dismissal key to toggle. */
  disKey: string;
  onDismiss: (key: string) => void;
  t: Strings;
}

// ── DISMISS BUTTON ───────────────────────────────────────────────────────────
// The ×/↩ button in the corner of every card, shared by SignCard and ErrorCard.
//
// It was the same nine lines in both, down to the stopPropagation — which is the
// load-bearing part: the button sits INSIDE a card that is itself activatable
// (see cardProps.ts), so a click that reached the card would dismiss the error
// and jump to it at the same time.
export const DismissButton = ({ dismissed, disKey, onDismiss, t }: DismissButtonProps) => {
  const label = dismissed ? t.restoreOne : t.dismissOne;
  return (
    <button
      className="dis-btn"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onDismiss(disKey);
      }}
    >
      {dismissed ? '↩' : '×'}
    </button>
  );
};
