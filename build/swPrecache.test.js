import { describe, it, expect } from 'vitest';
import { precacheUrls, buildId, renderServiceWorker, UNHASHED } from './swPrecache.js';

const EMITTED = ['index.html', 'assets/index-abc123.js', 'assets/index-def456.css'];

describe('precacheUrls', () => {
  it('includes the base URL itself, not just index.html', () => {
    // A navigation to /refcheck/ is cached under "/refcheck/". Precaching only
    // "/refcheck/index.html" would leave the offline fallback pointing at a key
    // that never gets populated — the bug this replaced.
    const urls = precacheUrls('/refcheck/', EMITTED);
    expect(urls).toContain('/refcheck/');
    expect(urls).not.toContain('/refcheck/index.html');
  });

  it('prefixes every emitted asset with the base', () => {
    const urls = precacheUrls('/refcheck/', EMITTED);
    expect(urls).toContain('/refcheck/assets/index-abc123.js');
    expect(urls).toContain('/refcheck/assets/index-def456.css');
  });

  it('includes the unhashed assets, which are not part of the bundle', () => {
    const urls = precacheUrls('/refcheck/', EMITTED);
    for (const name of UNHASHED) expect(urls).toContain(`/refcheck/${name}`);
  });

  it('never precaches the service worker itself', () => {
    // A cached worker script would pin the app to a stale build.
    const urls = precacheUrls('/refcheck/', [...EMITTED, 'sw.js']);
    expect(urls).not.toContain('/refcheck/sw.js');
  });

  it('tolerates a base without a trailing slash', () => {
    expect(precacheUrls('/refcheck', EMITTED)).toContain('/refcheck/assets/index-abc123.js');
  });

  it('works at the site root', () => {
    const urls = precacheUrls('/', EMITTED);
    expect(urls).toContain('/');
    expect(urls).toContain('/assets/index-abc123.js');
  });

  it('deduplicates', () => {
    const urls = precacheUrls('/refcheck/', [...EMITTED, 'assets/index-abc123.js']);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('includes a lazily-loaded chunk, so import-on-demand still works offline', () => {
    const urls = precacheUrls('/refcheck/', [...EMITTED, 'assets/docx-99xyz.js']);
    expect(urls).toContain('/refcheck/assets/docx-99xyz.js');
  });
});

describe('buildId', () => {
  it('changes when the asset set changes', () => {
    const a = buildId(precacheUrls('/refcheck/', EMITTED));
    const b = buildId(precacheUrls('/refcheck/', ['index.html', 'assets/index-CHANGED.js']));
    expect(a).not.toBe(b);
  });

  it('is stable for the same asset set regardless of order', () => {
    const a = buildId(['/b', '/a', '/c']);
    const b = buildId(['/c', '/a', '/b']);
    expect(a).toBe(b);
  });

  it('is a short non-empty token', () => {
    const id = buildId(precacheUrls('/refcheck/', EMITTED));
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBeLessThan(16);
  });
});

describe('renderServiceWorker', () => {
  const SRC = `const BUILD_ID = '__SW_BUILD_ID__';
const BASE = '__SW_BASE__';
const PRECACHE = __SW_PRECACHE__;`;

  it('substitutes all three placeholders', () => {
    const out = renderServiceWorker(SRC, { base: '/refcheck/', emitted: EMITTED });
    expect(out).not.toContain('__SW_BUILD_ID__');
    expect(out).not.toContain('__SW_BASE__');
    expect(out).not.toContain('__SW_PRECACHE__');
    expect(out).toContain(`const BASE = '/refcheck/';`);
  });

  it('emits the precache list as valid parseable JSON', () => {
    const out = renderServiceWorker(SRC, { base: '/refcheck/', emitted: EMITTED });
    const json = out.match(/const PRECACHE = (\[.*\]);/)[1];
    expect(JSON.parse(json)).toEqual(precacheUrls('/refcheck/', EMITTED));
  });

  it('throws if a placeholder is missing rather than shipping an empty precache', () => {
    // The whole offline guarantee rests on this substitution happening, so a
    // rename in sw.js must fail the build, not degrade silently.
    expect(() =>
      renderServiceWorker(`const BASE = '__SW_BASE__';`, { base: '/', emitted: [] })
    ).toThrow(/__SW_BUILD_ID__/);
  });
});
