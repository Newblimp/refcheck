// Vitest setup. Runs in every environment, but the DOM-only bits are guarded so
// the fast node-env logic tests are unaffected; only jsdom (*.ui.test.jsx) gets
// the matchers and browser-API stubs that jsdom does not implement.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  // jsdom has no matchMedia; the theme effect's "system" branch needs it.
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    });
  }

  // jsdom has no clipboard; RefList copy writes through it.
  if (!navigator.clipboard) {
    navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };
  }
}
