import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site at https://<user>.github.io/refcheck/,
// so assets must be referenced under the /refcheck/ base path.
export default defineConfig({
  base: '/refcheck/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
