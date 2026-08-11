import { describe, it, expect } from 'vitest';
import { inlineStylesheets } from './inlineCss.ts';

const HTML = `<!doctype html><html><head><title>x</title>
<link rel="stylesheet" crossorigin href="/refcheck/assets/index-abc123.css">
</head><body><div id="root"></div></body></html>`;

const lookup = (href: string): string | undefined =>
  href === '/refcheck/assets/index-abc123.css' ? 'body{color:red}' : undefined;

describe('inlineStylesheets', () => {
  it('replaces the stylesheet link with an inline style block', () => {
    const { html } = inlineStylesheets(HTML, lookup);
    expect(html).toContain('<style>body{color:red}</style>');
    expect(html).not.toContain('rel="stylesheet"');
  });

  it('reports which hrefs it consumed, so the caller can drop those assets', () => {
    // The build deletes them from the bundle: a .css left on disk beside its
    // inlined copy would still be precached by the service worker, which would
    // then fetch and store a file nothing ever requests.
    const { inlined } = inlineStylesheets(HTML, lookup);
    expect(inlined).toEqual(['/refcheck/assets/index-abc123.css']);
  });

  it('inlines the stylesheet where the link was, preserving cascade order', () => {
    const two = `<head><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"></head>`;
    const { html } = inlineStylesheets(two, (h) => (h === '/a.css' ? 'A{}' : 'B{}'));
    expect(html.indexOf('A{}')).toBeLessThan(html.indexOf('B{}'));
  });

  it('leaves a link the bundle does not own alone', () => {
    // Silently dropping a stylesheet would be a worse outcome than shipping the
    // extra request this plugin exists to remove.
    const ext = `<link rel="stylesheet" href="https://cdn.example/x.css">`;
    const { html, inlined } = inlineStylesheets(ext, () => undefined);
    expect(html).toBe(ext);
    expect(inlined).toEqual([]);
  });

  it('is a no-op on HTML with no stylesheet at all', () => {
    const bare = '<html><head></head><body></body></html>';
    expect(inlineStylesheets(bare, lookup).html).toBe(bare);
  });

  it('does not mistake a non-stylesheet link for one', () => {
    const icon = `<link rel="icon" href="/refcheck/assets/index-abc123.css">`;
    expect(inlineStylesheets(icon, lookup).html).toBe(icon);
  });
});
