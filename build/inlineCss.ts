// Build-time inlining of the app's stylesheet into index.html.
//
// Why: the stylesheet is render-blocking and was a separate request, so the
// static shell in index.html could not paint until a second round trip had
// completed. It is ~5 KB gzipped — small enough that shipping it inside the HTML
// response is strictly cheaper than fetching it, and it means the shell paints
// from the very first response with no further network at all.
//
// The <style> is placed where the <link> was, so the cascade is unchanged: the
// stylesheet still precedes anything a later plugin might inject into <head>.
//
// The CSS asset is also DELETED from the bundle rather than left on disk beside
// its inlined copy. That is not tidiness — swPrecachePlugin derives the service
// worker's precache list from the bundle keys, and a stale .css entry there
// would make the worker fetch and cache a file nothing ever requests. The two
// plugins therefore have an ordering requirement (see swPrecachePlugin's note).

import type { Plugin, ResolvedConfig, Rollup } from 'vite';

/** Matches the <link rel="stylesheet"> Vite injects for the bundled CSS. */
const LINK_RE = /<link[^>]+rel="stylesheet"[^>]*>/g;

/**
 * Replace the stylesheet <link>s in an HTML document with inline <style> blocks.
 *
 * Returns the HTML unchanged when there is nothing to inline, so an HTML file
 * with no stylesheet link is not an error.
 *
 * @param html    Contents of the emitted index.html
 * @param lookup  href → CSS source, or undefined if the bundle does not own it
 * @returns the rewritten HTML plus the hrefs actually consumed
 */
export function inlineStylesheets(
  html: string,
  lookup: (href: string) => string | undefined
): { html: string; inlined: string[] } {
  const inlined: string[] = [];
  const out = html.replace(LINK_RE, (tag) => {
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!href) return tag;
    const css = lookup(href);
    // An href the bundle does not own (an absolute URL, say) is left alone
    // rather than dropped — silently deleting a stylesheet would be worse than
    // shipping the extra request this plugin exists to remove.
    if (css === undefined) return tag;
    inlined.push(href);
    return `<style>${css}</style>`;
  });
  return { html: out, inlined };
}

/**
 * Vite plugin: inline the bundled CSS into index.html and drop the CSS asset.
 *
 * `generateBundle` rather than `transformIndexHtml` because the asset has to be
 * removed from the bundle object itself, which is only reachable here — and
 * because it must be gone before swPrecachePlugin reads the bundle keys.
 */
export function inlineCssPlugin(): Plugin {
  let base = '/';
  return {
    name: 'refcheck-inline-css',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved: ResolvedConfig) {
      base = resolved.base;
    },
    generateBundle(_options: Rollup.NormalizedOutputOptions, bundle: Rollup.OutputBundle) {
      const htmlKey = Object.keys(bundle).find((k) => k.endsWith('.html'));
      if (!htmlKey) return;
      const html = bundle[htmlKey];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;

      // href in the HTML is base-prefixed ("/refcheck/assets/x.css"); the bundle
      // is keyed by the bundle-relative name ("assets/x.css").
      const prefix = base.endsWith('/') ? base : base + '/';
      const { html: rewritten, inlined } = inlineStylesheets(html.source, (href) => {
        const key = href.startsWith(prefix) ? href.slice(prefix.length) : href.replace(/^\//, '');
        const asset = bundle[key];
        if (!asset || asset.type !== 'asset' || typeof asset.source !== 'string') return undefined;
        return asset.source;
      });

      html.source = rewritten;
      for (const href of inlined) {
        const key = href.startsWith(prefix) ? href.slice(prefix.length) : href.replace(/^\//, '');
        delete bundle[key];
      }
    },
  };
}
