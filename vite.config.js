import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site at https://<user>.github.io/refcheck/,
// so assets must be referenced under the /refcheck/ base path.
export default defineConfig({
  base: '/refcheck/',
  plugins: [react()],
  test: {
    // Pure-logic tests run fast under node; only interactive component tests
    // (*.ui.test.jsx) need a DOM, so jsdom is scoped to them.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    environmentMatchGlobs: [['src/**/*.ui.test.jsx', 'jsdom']],
    setupFiles: ['src/test/setup.js'],
    globals: true,
  },
});
