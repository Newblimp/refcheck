import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swPrecachePlugin } from './build/swPrecache.js';

// GitHub Pages serves a project site at https://<user>.github.io/refcheck/,
// so assets must be referenced under the /refcheck/ base path.
export default defineConfig({
  base: '/refcheck/',
  // swPrecachePlugin injects the built asset list into dist/sw.js so the app
  // shell is cached at install time rather than opportunistically — see
  // build/swPrecache.js for why that distinction decides whether the app is
  // actually usable offline after one visit.
  plugins: [react(), swPrecachePlugin()],
  test: {
    // Pure-logic tests run fast under node; only interactive component tests
    // (*.ui.test.jsx) need a DOM, so jsdom is scoped to them.
    environment: 'node',
    include: ['{src,build}/**/*.test.{js,jsx}'],
    environmentMatchGlobs: [['src/**/*.ui.test.jsx', 'jsdom']],
    setupFiles: ['src/test/setup.js'],
    globals: true,
  },
});
