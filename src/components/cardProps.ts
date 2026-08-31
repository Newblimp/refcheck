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
      // Only when the CARD itself has focus. The buttons nested inside it —
      // dismiss, and the term chips on a sign card — bubble their key events up
      // here, and preventDefault would then cancel the browser's own
      // Enter/Space activation of that button and run the card's action
      // instead: keyboard users got the card's behaviour from every control on
      // it. The click path was already safe (each button stops propagation);
      // this is the same guarantee for the key path, in one place rather than
      // one handler per nested button.
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      e.stopPropagation();
      onActivate(e);
    },
  };
}
