import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderServiceWorker } from './swPrecache.ts';

// The install handler is where the offline guarantee is actually delivered, and
// it is the one part of sw.js with real branching in it. Rather than assert on
// its source text, this runs the WORKER THAT SHIPS — public/sw.js put through the
// same build substitution — against a fake CacheStorage.

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'),
  'utf8'
);

class FakeCache {
  constructor() {
    this.map = new Map();
  }
  async put(url, res) {
    this.map.set(String(url), res);
  }
  async match(url) {
    return this.map.get(String(url));
  }
}

class FakeCacheStorage {
  constructor() {
    this.stores = new Map();
  }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name);
  }
  /** No cache name: searches every cache in the origin, as the real one does. */
  async match(url) {
    for (const c of this.stores.values()) {
      const hit = await c.match(url);
      if (hit) return hit;
    }
    return undefined;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name) {
    return this.stores.delete(name);
  }
}

/**
 * Evaluate the rendered worker and run its install handler to completion.
 * Returns the URLs it went to the network for.
 */
async function install(emitted, caches, { failOn = null } = {}) {
  const src = renderServiceWorker(SRC, { base: '/refcheck/', emitted });
  const fetched = [];
  const fetch = async (url) => {
    fetched.push(url);
    const ok = url !== failOn;
    return { ok, status: ok ? 200 : 404, url };
  };

  const handlers = {};
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: 'https://example.test' },
  };

  new Function('self', 'caches', 'fetch', src)(self, caches, fetch);

  let waited;
  handlers.install({ waitUntil: (p) => (waited = p) });
  await waited;
  return fetched;
}

const BUILD_A = ['index.html', 'assets/vendor-AAA.js', 'assets/index-111.js'];
// Same vendor chunk, new app chunk — an ordinary app-code-only deploy.
const BUILD_B = ['index.html', 'assets/vendor-AAA.js', 'assets/index-222.js'];

describe('service worker install', () => {
  it('fetches and caches the whole shell on a first-ever install', async () => {
    const caches = new FakeCacheStorage();
    const fetched = await install(BUILD_A, caches);

    expect(fetched).toContain('/refcheck/');
    expect(fetched).toContain('/refcheck/assets/vendor-AAA.js');
    expect(fetched).toContain('/refcheck/assets/index-111.js');
    expect(fetched).toContain('/refcheck/manifest.webmanifest');

    const [cache] = [...caches.stores.values()];
    expect(cache.map.has('/refcheck/assets/vendor-AAA.js')).toBe(true);
  });

  it('carries an unchanged hashed chunk over from the previous build', async () => {
    // The cache name carries the build id, so every deploy opens an empty cache.
    // Without the carry-over an app-code-only change re-downloaded the 140 KB
    // vendor chunk that had not changed at all — which is what splitting it out
    // was supposed to avoid.
    const caches = new FakeCacheStorage();
    await install(BUILD_A, caches);
    const fetched = await install(BUILD_B, caches);

    expect(fetched).not.toContain('/refcheck/assets/vendor-AAA.js');
    expect(fetched).toContain('/refcheck/assets/index-222.js');

    // Carried over, not merely skipped: the new cache must actually hold it, or
    // the app is broken offline on the new build.
    const newest = [...caches.stores.values()].at(-1);
    expect(newest.map.has('/refcheck/assets/vendor-AAA.js')).toBe(true);
  });

  it('always refetches the URLs whose bytes can change under a stable URL', async () => {
    // The navigation, the manifest and the icon are not content-hashed. Carrying
    // those over would pin a changed icon or a changed shell forever.
    const caches = new FakeCacheStorage();
    await install(BUILD_A, caches);
    const fetched = await install(BUILD_B, caches);

    expect(fetched).toContain('/refcheck/');
    expect(fetched).toContain('/refcheck/manifest.webmanifest');
    expect(fetched).toContain('/refcheck/icon.svg');
  });

  it('rejects the install on a non-2xx rather than reporting a half-filled cache', async () => {
    // cache.addAll was all-or-nothing; the hand-rolled replacement has to be too,
    // or the worker activates claiming an offline guarantee it cannot honour.
    const caches = new FakeCacheStorage();
    await expect(
      install(BUILD_A, caches, { failOn: '/refcheck/assets/index-111.js' })
    ).rejects.toThrow(/precache failed/);
  });
});
