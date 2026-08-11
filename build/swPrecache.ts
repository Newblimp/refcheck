// Build-time generation of the service worker's precache list.
//
// Why this exists: the app promises to keep working offline, but the service
// worker registers *after* the page has already fetched its JS, CSS and fonts.
// Those first-visit requests are never intercepted, so a worker that only
// populates its cache from the fetch handler has an empty cache after the first
// visit — the app only became offline-capable on the *second* one. Precaching an
// explicit list at install time is what actually delivers the guarantee.
//
// The list has to be generated because Vite content-hashes every asset filename.
// The build id is derived from that same list, so a deploy that changes any
// asset gets a new cache name and the activate handler can evict the old one —
// otherwise old bundles accumulate in a single never-renamed cache forever.

import type { Plugin, ResolvedConfig, Rollup } from 'vite';

/** Assets served without a content hash: they can change under a stable URL. */
export const UNHASHED = ['manifest.webmanifest', 'icon.svg'];

/**
 * Short, stable id for a set of filenames (FNV-1a, base36).
 * Not cryptographic — it only needs to change when the asset set changes.
 */
export function buildId(names: string[]): string {
  const joined = [...names].sort().join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Build the list of URLs the service worker should precache.
 *
 * `base` itself is included deliberately: a navigation to /refcheck/ is cached
 * under the key "/refcheck/", not "/refcheck/index.html", so precaching only the
 * latter leaves the offline navigation fallback pointing at a key that is never
 * populated.
 *
 * @param base     Vite base path, e.g. "/refcheck/"
 * @param emitted  Bundle-relative filenames, e.g. "assets/index-ab12.js"
 * @returns absolute URLs, deduplicated, in stable order
 */
export function precacheUrls(base: string, emitted: string[]): string[] {
  const prefix = base.endsWith('/') ? base : base + '/';
  const urls = new Set([prefix]);
  for (const name of emitted) {
    // index.html is reachable as the base URL, already added above. sw.js must
    // never cache itself — the browser handles worker updates separately, and a
    // cached worker script would pin the app to a stale build.
    if (name === 'sw.js' || name === 'index.html') continue;
    urls.add(prefix + name);
  }
  for (const name of UNHASHED) urls.add(prefix + name);
  return [...urls];
}

const TOKENS = ['__SW_BUILD_ID__', '__SW_BASE__', '__SW_PRECACHE__'];

/**
 * Substitute the build-time constants into the service worker source.
 * Throws if a token is missing, so a rename in sw.js cannot silently ship a
 * worker that precaches nothing.
 *
 * @param source  The service worker source, TYPES ALREADY STRIPPED. That order
 *   is load-bearing: sw.ts declares the three tokens as ambient constants so it
 *   can type-check, and substituting first would rewrite the tokens inside those
 *   `declare` lines too and emit `declare const ["/a","/b"]: string[]`.
 */
export function renderServiceWorker(
  source: string,
  { base, emitted }: { base: string; emitted: string[] }
): string {
  for (const token of TOKENS) {
    if (!source.includes(token))
      throw new Error(`sw.js is missing the ${token} placeholder — precaching would be skipped`);
  }
  const urls = precacheUrls(base, emitted);
  // All three values are substituted as JSON literals, because in sw.ts the
  // tokens are bare identifiers (`const BASE = __SW_BASE__;`) rather than the
  // contents of a string. They have to arrive carrying their own quotes; they
  // used to sit inside quotes in the source, and emitting them raw produced
  // `const BASE = /;`.
  return source
    .replaceAll('__SW_BUILD_ID__', JSON.stringify(buildId(urls)))
    .replaceAll('__SW_BASE__', JSON.stringify(base.endsWith('/') ? base : base + '/'))
    .replaceAll('__SW_PRECACHE__', JSON.stringify(urls));
}

/**
 * Strip the types from the service worker source.
 *
 * The worker is TypeScript like everything else, but it cannot go through the
 * normal bundle: it has to ship as a CLASSIC script at a stable, unhashed URL
 * (`navigator.serviceWorker.register` is called without `{type:'module'}`, and
 * Firefox still does not support module workers), and a worker that imports a
 * chunk in order to boot defeats its own purpose. It has no imports and no
 * exports, so it needs type ERASURE, not bundling — which is exactly what this
 * is. The emitted bytes are the source minus its annotations.
 *
 * esbuild is already a dependency of Vite, so this adds nothing to install.
 */
async function stripTypes(source: string): Promise<string> {
  const { transform } = await import('esbuild');
  const out = await transform(source, {
    loader: 'ts',
    // No module wrapper: the output must stay a classic script.
    format: 'iife',
    target: 'es2022',
  });
  return out.code;
}

/**
 * Vite plugin: compile src/sw.ts and write dist/sw.js.
 *
 * `writeBundle` rather than `generateBundle` because the worker is not part of
 * the bundle at all — the precache list is derived FROM the bundle, so this has
 * to run once the rest of the build is known.
 */
export function swPrecachePlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'refcheck-sw-precache',
    apply: 'build',
    configResolved(resolved: ResolvedConfig) {
      config = resolved;
    },
    async writeBundle(options: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle) {
      const { readFile, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const outDir = options.dir || join(config.root, config.build.outDir);
      const source = await readFile(join(config.root, 'src', 'sw.ts'), 'utf8');
      // Strip first, substitute second — see renderServiceWorker.
      const rendered = renderServiceWorker(await stripTypes(source), {
        base: config.base,
        emitted: Object.keys(bundle),
      });
      await writeFile(join(outDir, 'sw.js'), rendered);
    },
  };
}
