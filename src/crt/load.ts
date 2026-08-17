// ── THE CRT STYLESHEET, ON DEMAND ────────────────────────────────────────────
// crt.css is the whole cost of the screen filter, and it is fetched only once
// somebody switches the filter on — the same rule the .docx pipeline, the help
// screen and the bee follow, and for the same two reasons:
//
//   · the app's own stylesheet is INLINED into index.html (build/inlineCss.ts),
//     so anything added to it is downloaded by every first visit whether or not
//     it is ever used. A dynamic import makes this its own asset instead;
//   · that asset is still in the service worker's precache list, which
//     swPrecache derives from the emitted bundle — so the first time the filter
//     is switched on may just as well be offline.
//
// Vite turns the dynamic import into a stylesheet the browser applies as soon
// as the promise resolves; there is nothing to render and nothing to unmount.
// Switching the filter back off removes the attribute the rules hang off, so
// the loaded stylesheet simply stops matching anything.

/** The in-flight (then settled) import, so repeated toggles fetch once. */
let pending: Promise<unknown> | null = null;
/** Whether the stylesheet has landed, so a re-enable can apply synchronously. */
let ready = false;

/** Has the stylesheet already arrived? */
export const crtReady = () => ready;

/**
 * Fetch the CRT stylesheet (idempotent).
 *
 * Also worth calling on hover of the toggle, the way the help button preloads
 * its dialog: by the time the click lands the stylesheet is usually already
 * applied, so the filter appears at once rather than a request later.
 */
export function loadCrt(): Promise<unknown> {
  pending ??= import('./crt.css').then((m) => {
    ready = true;
    return m;
  });
  return pending;
}
