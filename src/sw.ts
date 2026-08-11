// Offline cache for the RefSign Checker app shell.
//
// The three constants below are substituted at build time by the
// refcheck-sw-precache plugin (build/swPrecache.js); the placeholder text is
// what ships in the repo and is never what runs. The plugin throws if it cannot
// find them, so a rename here cannot silently ship a worker that caches nothing.
// Ambient declarations for the three build-time constants. They are `declare`
// so the substitution below has something to type-check against; the statements
// erase entirely, which is why the type stripping has to run BEFORE the token
// substitution (see swPrecache.ts) — otherwise replaceAll would rewrite the
// tokens inside these lines too and emit `declare const ["/a","/b"]: string[]`.
declare const __SW_BUILD_ID__: string;
declare const __SW_BASE__: string;
declare const __SW_PRECACHE__: string[];

// This file runs in a ServiceWorkerGlobalScope, not a window. `lib: WebWorker`
// types the global `self` as the generic WorkerGlobalScope, which has no
// skipWaiting, no clients and no install/fetch events — so narrow it once here
// rather than redeclaring the global (which the lib already owns) or asserting
// at each use. With this in place the handlers below get real ExtendableEvent
// and FetchEvent types, including the fact that `caches.match()` may resolve to
// undefined.
const sw = self as unknown as ServiceWorkerGlobalScope;

const BUILD_ID = __SW_BUILD_ID__;
const BASE = __SW_BASE__;
const PRECACHE = __SW_PRECACHE__;

// Named after the build id, so each deploy gets its own cache and the activate
// handler below can evict the previous one. A fixed name (what this used to
// have) meant the cleanup never matched anything and every deploy's hashed
// bundles accumulated in one cache indefinitely.
const CACHE_NAME = `refcheck-shell-${BUILD_ID}`;

// Served without a content hash, so their contents can change under a stable
// URL — these must not be cached-first or a changed icon/manifest is pinned
// forever.
const UNHASHED = new Set([`${BASE}manifest.webmanifest`, `${BASE}icon.svg`]);

// Options for every cache lookup in this file.
//
// ignoreVary is load-bearing, not defensive. Static hosts (GitHub Pages, and
// Vite's own preview server) send "Vary: Origin" on assets. Entries put there at
// install time were requested without an Origin header, while the page's own
// module-script requests are CORS-mode and DO send one — so Vary matching
// rejects the precached entry and every asset misses the cache offline. The page
// then fails to boot despite a fully populated cache, which is exactly what an
// end-to-end offline test caught here. These URLs are content-hashed, so their
// bytes cannot legitimately vary by request header.
//
// ignoreSearch keeps a query string (?utm_source=…) from missing the shell.
const MATCH_OPTS: CacheQueryOptions = { ignoreVary: true, ignoreSearch: true };

// Precache the whole shell up front. The worker registers after the page has
// already fetched its assets, so those requests never reach the fetch handler;
// without this the cache would still be empty after a first visit and the app
// would only work offline from the second visit onwards.
//
// This is cache.addAll with one addition: a content-hashed URL that a PREVIOUS
// deploy's cache already holds is copied across instead of refetched. Because
// the cache name carries the build id, every deploy opens an empty cache, so an
// app-code-only change used to re-download the unchanged vendor chunk (140 KB)
// along with it. Copying is safe precisely because the URL is content-hashed —
// same URL cannot mean different bytes.
//
// The all-or-nothing behaviour of addAll is preserved deliberately: a non-2xx
// rejects the whole install, because a half-filled cache that reports success is
// exactly the failure this precaching exists to prevent.
async function precacheAll(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE.map(async (url) => {
      if (!mustRefetch(url)) {
        // caches.match with no cache name searches every cache in the origin,
        // which at install time still includes the outgoing build's.
        const carried = await caches.match(url, MATCH_OPTS);
        if (carried) return cache.put(url, carried);
      }
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`precache failed for ${url}: ${res.status}`);
      return cache.put(url, res);
    })
  );
}

// Whether a precache URL must come from the network rather than from an older
// cache. Only content-hashed URLs may be carried over; anything whose bytes can
// change under a stable URL has to be fetched, or a deploy would pin the old
// icon, manifest or index document forever.
function mustRefetch(url: string): boolean {
  return url === BASE || UNHASHED.has(url);
}

sw.addEventListener('install', (event) => {
  event.waitUntil(precacheAll().then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => sw.clients.claim())
  );
});

// Cache a response without blocking the one being returned, but keep the worker
// alive until the write lands (an un-awaited put can be killed mid-flight).
function cachePut(event: ExtendableEvent, request: Request, response: Response): void {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(request, response)));
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(sw.location.origin)) return;

  // Navigations: network-first so a returning-online user gets the latest build.
  // Offline, fall back to this exact URL and then to the precached shell. Both
  // lookups ignore the query string: a navigation to ?foo=1 is still the shell,
  // and without ignoreSearch it would miss the cache and resolve to undefined.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          cachePut(event, request, res.clone());
          return res;
        })
        .catch(async () => {
          const hit =
            (await caches.match(request, MATCH_OPTS)) ?? (await caches.match(BASE, MATCH_OPTS));
          // Offline with nothing cached — a first visit that never completed.
          // There is genuinely nothing to serve, so fail the request rather than
          // handing respondWith an undefined: per spec that is a network error
          // either way, but it also raises an unhandled rejection, so the
          // failure reads as a bug in the worker rather than as being offline.
          if (!hit) throw new Error('offline: navigation not cached');
          return hit;
        })
    );
    return;
  }

  // Unhashed assets: network-first, cache as fallback.
  const url = new URL(request.url);
  if (UNHASHED.has(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) cachePut(event, request, res.clone());
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(request, MATCH_OPTS);
          if (!hit) throw new Error('offline: asset not cached');
          return hit;
        })
    );
    return;
  }

  // Everything else is content-hashed: a given URL can never change meaning, so
  // cache-first is safe and never needs revalidation. Lazily-loaded chunks are
  // in PRECACHE, so this stays a hit even for code the user has not run yet.
  event.respondWith(
    caches.match(request, MATCH_OPTS).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) cachePut(event, request, res.clone());
        return res;
      });
    })
  );
});
