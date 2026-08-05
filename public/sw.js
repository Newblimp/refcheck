// Offline cache for the RefSign Checker app shell.
//
// The three constants below are substituted at build time by the
// refcheck-sw-precache plugin (build/swPrecache.js); the placeholder text is
// what ships in the repo and is never what runs. The plugin throws if it cannot
// find them, so a rename here cannot silently ship a worker that caches nothing.
const BUILD_ID = '__SW_BUILD_ID__';
const BASE = '__SW_BASE__';
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

// Precache the whole shell up front. The worker registers after the page has
// already fetched its assets, so those requests never reach the fetch handler;
// without this the cache would still be empty after a first visit and the app
// would only work offline from the second visit onwards.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Cache a response without blocking the one being returned, but keep the worker
// alive until the write lands (an un-awaited put can be killed mid-flight).
function cachePut(event, request, response) {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(request, response)));
}

// Options for every cache lookup below.
//
// ignoreVary is load-bearing, not defensive. Static hosts (GitHub Pages, and
// Vite's own preview server) send "Vary: Origin" on assets. Entries put there by
// cache.addAll at install time were requested without an Origin header, while
// the page's own module-script and stylesheet requests are CORS-mode and DO send
// one — so Vary matching rejects the precached entry and every asset misses the
// cache offline. The page then fails to boot despite a fully populated cache,
// which is exactly what an end-to-end offline test caught here. These URLs are
// content-hashed, so their bytes cannot legitimately vary by request header.
//
// ignoreSearch keeps a query string (?utm_source=…) from missing the shell.
const MATCH_OPTS = { ignoreVary: true, ignoreSearch: true };

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  // Navigations: network-first so a returning-online user gets the latest build.
  // Offline, fall back to this exact URL and then to the precached shell. Both
  // lookups ignore the query string: a navigation to ?foo=1 is still the shell,
  // and without ignoreSearch it would miss the cache and resolve to undefined —
  // which respondWith turns into a network error rather than the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          cachePut(event, request, res.clone());
          return res;
        })
        .catch(() =>
          caches.match(request, MATCH_OPTS).then((res) => res || caches.match(BASE, MATCH_OPTS))
        )
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
        .catch(() => caches.match(request, MATCH_OPTS))
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
