import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.jsx';

// A server-side render exercises App.jsx and every component it imports,
// catching wiring/import mistakes that the pure-logic tests cannot.
describe('App (render smoke test)', () => {
  it('renders to HTML without throwing', () => {
    const html = renderToString(<App />);
    expect(html).toContain('RefSign');
    expect(html).toContain('REFERENCE SIGNS');
  });
});
