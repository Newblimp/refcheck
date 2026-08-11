// Vitest setup. Runs in every environment, but the DOM-only bits are guarded so
// the fast node-env logic tests are unaffected; only jsdom (*.ui.test.tsx) gets
// the matchers and browser-API stubs that jsdom does not implement.
//
// The casts below are all of one kind: jsdom is missing an API, and the stub
// implements only the surface the app actually touches. Each is written as a
// cast at the assignment rather than by loosening a type, so the narrowness is
// visible at the point where it is chosen.
export {};

if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  // jsdom has no matchMedia; the theme effect's "system" branch needs it.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: false,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
  }

  // jsdom has no clipboard; RefList copy writes through it. `navigator.clipboard`
  // is read-only, so it has to be defined rather than assigned.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => Promise.resolve()) },
    });
  }

  // jsdom has no object URLs; .docx export hands the bytes to a download link
  // through one. Keep the Blob so a test can read back what was exported —
  // see the declaration in globals.d.ts.
  if (!URL.createObjectURL) {
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      globalThis.__lastExportedBlob = obj as Blob;
      return 'blob:refcheck/export';
    };
    URL.revokeObjectURL = () => {};
  }
}
