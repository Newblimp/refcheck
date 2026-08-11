import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { swPrecachePlugin } from './build/swPrecache.ts';
import { inlineCssPlugin } from './build/inlineCss.ts';

// Defaults to a root-domain deploy (Cloudflare Workers/Pages, or any host that
// serves the app at "/"). GitHub Pages serves a project site instead, at
// https://<user>.github.io/refcheck/, so assets there must be referenced under
// the /refcheck/ base path — .github/workflows/deploy.yml sets VITE_BASE for
// that build specifically, rather than this file guessing which host it is on.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  // inlineCssPlugin folds the stylesheet into index.html (and removes the CSS
  // asset) so the static shell paints from the first response; swPrecachePlugin
  // then injects the resulting asset list into dist/sw.js so the app shell is
  // cached at install time rather than opportunistically — see
  // build/swPrecache.js for why that distinction decides whether the app is
  // actually usable offline after one visit. The order matters: the precache
  // list must be built from the bundle the inliner has already pruned.
  // The app is written against the React API and stays that way; only the
  // implementation underneath it changed. @preact/preset-vite aliases react and
  // react-dom to preact/compat, which took React+ReactDOM's 140.78 KB (45.23 KB
  // gzipped, 62% of the bundle and 26% of everything the first visit fetched)
  // down to a few KB. It was viable because the API surface here is plain: only
  // the standard hooks plus createRoot and StrictMode — no portals, no Suspense,
  // no React.lazy, no flushSync, no concurrent features. The 668-test suite runs
  // through this same config, so it is the gate on the swap rather than an
  // afterthought.
  plugins: [preact(), inlineCssPlugin(), swPrecachePlugin()],
  // Declared here rather than left to @preact/preset-vite, which does not apply
  // its aliases under Vitest — the app would run on preact while the tests drove
  // the real react-dom, and the two runtimes cannot share a component tree.
  //
  // The array form is used because it is ORDER-SENSITIVE and two of these are
  // prefixes of each other: 'react-dom/test-utils' must be matched before
  // 'react-dom', or it resolves to preact/compat/test-utils and the test
  // helpers are missing. 'react-dom/client' needs no entry of its own — the
  // 'react-dom' rule rewrites it to preact/compat/client, which preact exports.
  resolve: {
    alias: [
      { find: /^react-dom\/test-utils$/, replacement: 'preact/test-utils' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react-dom\//, replacement: 'preact/compat/' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
      { find: /^react$/, replacement: 'preact/compat' },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // The framework changes only when the dependency is upgraded, while the
        // app code changes every deploy. As one chunk, a one-line app change
        // re-downloaded all of it; split, the service worker's install carries
        // the unchanged vendor chunk over from the previous build's cache (see
        // sw.js) instead of refetching it.
        manualChunks: { vendor: ['preact', 'preact/compat', 'preact/hooks'] },
      },
    },
  },
  test: {
    // Pure-logic tests run fast under node; only interactive component tests
    // (*.ui.test.jsx) need a DOM, so jsdom is scoped to them.
    environment: 'node',
    // MIGRATION SCAFFOLDING — narrow to {ts,tsx} once no .js/.jsx test remains.
    // A glob that stops matching a file does not fail; it silently stops running
    // it, so this stays permissive until the last test file is converted.
    include: ['{src,build}/**/*.test.{js,jsx,ts,tsx}'],
    environmentMatchGlobs: [['src/**/*.ui.test.{jsx,tsx}', 'jsdom']],
    setupFiles: ['src/test/setup.ts'],
    globals: true,
  },
});
