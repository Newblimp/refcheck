import type { JSX } from 'preact';

// Shared accessibility wiring for the sidebar's error cards.
//
// Clicking a card to jump to its occurrence in the text is the app's primary
// interaction, but every card was a plain <div onClick> — no role, no tab stop,
// no key handler — so none of it was reachable without a mouse. These cards
// cannot simply become <button>s: each one already contains a nested dismiss
// button, and nesting interactive elements is invalid HTML.
//
// So they get the button *role* explicitly, plus the keyboard behaviour a real
// button would have had for free.
export function activatable(onActivate: (e: Event) => void): {
  role: 'button';
  tabIndex: number;
  onClick: JSX.MouseEventHandler<HTMLElement>;
  onKeyDown: JSX.KeyboardEventHandler<HTMLElement>;
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      // Space must not scroll the sidebar, and both keys must not reach a parent.
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      onActivate(e);
    },
  };
}
