import { memo, useEffect, useRef } from 'react';
import { ChevronIcon } from './icons.tsx';
import type { Strings } from '../i18n.ts';

// ── FIND BAR ────────────────────────────────────────────────────────────────
// Ctrl+F: find text in the editor.
//
// Not to be confused with the sidebar's filter box (Ctrl+Shift+F), which
// narrows the list of FINDINGS by sign or term. This searches the draft itself,
// which is what Ctrl+F means everywhere else and what a drafter reaches for it
// expecting.
//
// It owns no state — App holds the query, the match list and the cursor, since
// the matches are also what the highlight backdrop renders.

export interface FindBarProps {
  t: Strings;
  query: string;
  onQuery: (value: string) => void;
  /** How many matches the query has, and which one is current (0-based). */
  count: number;
  index: number;
  /** The match list hit MAX_MATCHES, so `count` is a floor rather than a total. */
  capped: boolean;
  onStep: (delta: number) => void;
  onClose: () => void;
  /**
   * Bumped on every Ctrl+F. Pressing it again while the bar is already open
   * should put the cursor back in the box and select what is there — the same
   * thing every other find bar does — and a counter is what carries "it was
   * pressed again" when nothing else about the props changed.
   */
  focusToken: number;
}

function FindBarImpl({
  t,
  query,
  onQuery,
  count,
  index,
  capped,
  onStep,
  onClose,
  focusToken,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select rather than clear: reopening with the previous query visible lets
    // the drafter either step through the old search or type straight over it.
    // Only when there IS one — selecting an empty box does nothing but open a
    // window in which an already-typed first character can be selected and then
    // overwritten by the second.
    if (el.value) el.select();
  }, [focusToken]);

  return (
    <div className="find-bar" role="search">
      <input
        className="find-in"
        ref={inputRef}
        value={query}
        placeholder={t.findPh}
        aria-label={t.findPh}
        spellcheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onInput={(e) => onQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter and Escape are handled here rather than in useHotkeys, which
          // suppresses unmodified keys while the user is typing in a field —
          // and this field is one.
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <span className={`find-count${query && count === 0 ? ' none' : ''}`} aria-live="polite">
        {!query ? '' : count === 0 ? t.findNone : t.findCount(index + 1, count, capped)}
      </span>
      <button
        className="nav-btn"
        onClick={() => onStep(-1)}
        disabled={count === 0}
        aria-label={t.findPrev}
        title={t.findPrev}
      >
        <ChevronIcon left />
      </button>
      <button
        className="nav-btn"
        onClick={() => onStep(1)}
        disabled={count === 0}
        aria-label={t.findNext}
        title={t.findNext}
      >
        <ChevronIcon />
      </button>
      <button className="imp-x" onClick={onClose} aria-label={t.findClose} title={t.findClose}>
        ×
      </button>
    </div>
  );
}

export const FindBar = memo(FindBarImpl);
