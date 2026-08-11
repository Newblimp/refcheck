# RefSign Checker — load & interaction performance plan

_What makes os8088.com feel instant, which of those techniques apply here, and what else the
measurements turned up. Offline capability is a hard constraint throughout: nothing in this plan
weakens the guarantee that the tool works after one visit with the network off._

## Verdict

The tool's **compute** is already fast — the quadratic scans are gone and extraction sits well
inside the debounce. The two things that are slow are the two things nobody has measured yet:

1. **What it ships.** 177 KB on the wire before the app can paint, of which **54% is fonts** —
   more than React and the entire application put together. Every byte of it is avoidable or
   shrinkable.
2. **What it builds on boot.** A restored 112 KB document costs **77 ms of synchronous work per
   buffer** before first paint, and produces a backdrop of **11,704 `<mark>` elements** that is
   rebuilt on every settled keystroke.

Phase 1 below is a day of low-risk work that takes the critical path from **177 KB / 9 requests**
to roughly **87 KB / 3 requests**, and moves first paint from "after 227 KB of JavaScript parses"
to "on the first HTML response". Phase 2 and 3 are bigger bets, gated on measurement.

## What os8088.com actually does

The site's own [colophon](https://os8088.com/colophon/) is explicit about its method. Six
techniques, and one principle underneath them.

| Technique                                                                                             | The point                                             |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Static HTML — the content is in the response                                                          | First paint is one round trip, not a JS boot          |
| **Body prose is not a web font at all** — "whatever monospace face your own system supplies"          | The largest reading surface costs **zero** downloads  |
| The one web font is cut to `unicode-range: U+0020-007E`                                               | Ships ~95 glyphs instead of a few hundred             |
| The logo is **generated inline SVG** — the build reads the kernel's 11×11 bitmap and emits rectangles | No image request, sharp at any size                   |
| Screenshots are 16-colour indexed PNGs plus a nearest-neighbour 2× copy                               | Palette matched to the content, not a generic encoder |
| The 2.4 MB v86 emulator **loads only when you ask for it**; the floppy images are 16 KB on the wire   | Heavy things are opt-in and compress                  |

There is also a layout discipline worth stealing: a single unit `--u` (one OS pixel = 2 CSS px),
with **every metric an integer multiple of it**. No sub-pixel geometry, so nothing reflows into a
slightly different position — cumulative layout shift by construction rather than by measurement.

The principle: **ship nothing you have not proven you need, and let the first paint happen
without JavaScript.**

> Note on sourcing: `os8088.com` is blocked by this session's egress proxy, so the site could not
> be fetched or profiled directly. The techniques above are quoted from its colophon via search
> snippets. Everything about **this** repo below is measured on this tree.

## Where refcheck stands (measured, `npm run build`, this tree)

**Critical path — what must arrive before the app can render:**

| Asset                                                                   | Wire bytes   | Share |
| ----------------------------------------------------------------------- | ------------ | ----- |
| `index.html`                                                            | 0.59 KB gz   | 0.3%  |
| `index-*.css`                                                           | 4.98 KB gz   | 2.8%  |
| `index-*.js` — React + DOM                                              | 45.23 KB gz  | 25.6% |
| `index-*.js` — app code                                                 | 30.42 KB gz  | 17.2% |
| **Fonts × 6** (woff2)                                                   | **95.82 KB** | 54.2% |
| **Total**                                                               | **176.6 KB** |       |
| — plus 9 requests, 6 of them fonts discovered only after the CSS parses |              |       |

Precached by the service worker immediately after load: `importDoc` chunk 12.75 KB gz, `bee.svg`
2.03 KB gz. Total first-visit footprint ≈ **191 KB**.

**Boot work**, measured on a 112,559-character description (900 sentences, 184 signs):

| Step           | Time        | Output                              |
| -------------- | ----------- | ----------------------------------- |
| `extractData`  | 48.7 ms     | 184 signs, 904 article errors       |
| `buildHtml`    | 23.1 ms     | **500 KB of HTML, 11,704 `<mark>`** |
| `getAllErrors` | 4.9 ms      | 6,304 errors                        |
| **Total**      | **76.7 ms** | per buffer, on a fast machine       |

`useDebounced` passes its **initial** value through synchronously (`if (delay <= 0) ref.current = value`,
and the effect has not run yet on mount), so a restored session with both buffers populated pays
this **twice before first paint** — ~150 ms here, realistically 400–600 ms on a mid-range laptop,
on top of parsing 227 KB of JavaScript. The sidebar then mounts **1,088 cards**.

Three facts frame everything below:

- **Fonts outweigh all the JavaScript.** 95.82 KB of font versus 75.65 KB gz of JS.
- **React is 62% of the bundle** and 26% of the critical path. The app's own code is 30 KB gz.
- **Nothing paints until JS runs.** `<div id="root"></div>` is the whole body.

---

## Phase 1 — first paint (direct ports of os8088's method)

Low risk, no architectural change, roughly a day. Ordered by payoff.

### 1.1 Cut fonts from 96 KB to ~6 KB

This is the single largest win available and it is a near-exact port of what os8088 does.

**(a) The editor becomes a system monospace — `−43 KB`.**
`--font-mono` is `'JetBrains Mono', monospace` and drives `.backdrop`/`.editor-ta`, the largest
text surface in the app. This is precisely os8088's "body prose is not a web font at all". Replace
with a real system stack:

```css
--font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
```

Both JetBrains Mono files (43.0 KB) stop shipping entirely.

_Alignment check:_ the backdrop and the textarea must remain metrically identical, or the
highlight spans drift. They already share `var(--font-mono)`, so they stay locked to each other on
any machine — the invariant is "same font on both layers", not "same font on every machine". The
trailing-newline sentinel and `backdropScroll` are unaffected. Worth one manual pass on
Windows/macOS/Linux anyway, since line-height rounding differs per face.

**(b) Space Grotesk: four weights → one — `−39 KB`.**
Weight usage across `styles.css` is 400 ×2, 500 ×7, **600 ×13**, 700 ×3. Four separate files for
that is not earning its keep. Either ship the **variable** cut of Space Grotesk (one file covering
400–700) or keep **600 only** and let 500/700 synthesize. Recommended: 600 alone first, measure
whether anything looks wrong, add 700 back only if it does.

**(c) Subset what remains — a further `~60%`.**
The UI strings are English and German: ASCII, `äöüßÄÖÜ`, and a handful of typographic marks.

```
pyftsubset space-grotesk-600.ttf --flavor=woff2 \
  --unicodes=U+0020-007E,U+00A0-00FF,U+2010-2027,U+20AC \
  --layout-features='' --output-file=space-grotesk-600.subset.woff2
```

13.3 KB → roughly 5 KB. Declare the range in the `@font-face` too, so a stray glyph falls back
rather than rendering as tofu.

**(d) Give the fallbacks a real system stack.** `--font-ui` currently falls back to bare
`sans-serif`. During the swap frame — and permanently for anyone the font fails for — that is
whatever the browser default is. Use `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.

**Net: 95.82 KB → ~5 KB, and 6 font requests → 1.**

### 1.2 Inline the CSS — `−1 request from the critical path`

4.98 KB gz is small enough to inline into `index.html`, removing a render-blocking round trip and
letting the shell paint from the single HTML response. A ~15-line Vite plugin in `build/`
(alongside `swPrecache.js`) at `transformIndexHtml`, or `vite-plugin-singlefile`-style manual
inlining. One fewer precache entry for the service worker as a side effect.

### 1.3 Paint a static shell before React

Today the body is empty until 227 KB of JS parses, executes, and React commits its first tree.
refcheck cannot pre-render the user's _document_ — but it can pre-render the _frame_, which is
what the eye actually registers as "the app is here".

Put the real chrome into `index.html` inside `#root`: the top bar, the three-column grid, the
editor box, the two pane headers — static markup at the exact geometry React will produce, styled
by the now-inlined CSS. `createRoot(...).render()` replaces the container's children on first
commit, so **no hydration machinery is needed** and no React code changes at all.

Combined with 1.2, first paint becomes "as soon as the HTML arrives" — the os8088 property. It
also closes the current gap between the inline theme script (which runs immediately) and mount.

### 1.4 Preload the surviving font

```html
<link
  rel="preload"
  as="font"
  type="font/woff2"
  href="/refcheck/assets/space-grotesk-600-*.woff2"
  crossorigin
/>
```

Fonts are currently discovered only after the CSS parses. The href is content-hashed, so this has
to be emitted by the same build plugin that inlines the CSS — it already has the manifest.

### 1.5 Defer the bee

`Bee.jsx` and `bee.svg` (2.03 KB gz) ship on the critical path for an easter egg most users never
see. `useBee` already gates it behind a rare draw or typing "bee", so the sprite and component can
load on first spawn via a dynamic `import()` — exactly the pattern `importDoc` already uses (a
plain dynamic import, no `React.lazy`/`Suspense` anywhere in this app). **Keep both in the
precache list**, same reasoning as the `.docx` chunk: offline-first means the deferred thing must
still be there with the network off.

This is the small-scale version of os8088's "the 2.4 MB emulator loads only when you ask for it".

### 1.6 Split the vendor chunk

React and app code are one 227 KB file today, so **every deploy re-downloads all of it** even when
only app code changed. `manualChunks: { vendor: ['react', 'react-dom'] }` splits it 140.78 / 85.88.
Measured, not assumed — that split is where the "React is 62%" figure comes from.

Note the interaction with the service worker: the cache is keyed on `BUILD_ID`, so a new deploy
opens a fresh cache and re-fetches everything regardless. To actually collect this win, `install`
should try `caches.match` against the _old_ cache before fetching each precache URL — unchanged
hashed assets then copy across instead of re-downloading. That is a ~10-line change to `install`
and it needs its own test in `swPrecache.test.js`.

### 1.7 A payload budget in CI

`perf.test.js` guards extraction _time_ and nothing guards _bytes_ — which is where the site the
user admires wins. Add a build-output assertion: fail if initial JS gz > N, total critical-path
bytes > M. Without this, Phase 1 erodes.

**Phase 1 result: 176.6 KB → ~87 KB critical path, 9 requests → 3, first paint from the HTML.**

---

## Phase 2 — the JavaScript (measure, then decide)

### 2.1 Preact via `preact/compat` — potentially `−40 KB gz`

React + ReactDOM is 45.23 KB gz. `preact/compat` is ~5 KB gz. That is a bigger saving than the
entire CSS and app-specific JS combined, from a **single alias in `vite.config.js`**:

```js
resolve: { alias: { react: 'preact/compat', 'react-dom': 'preact/compat' } }
```

The API surface here is unusually favourable. A sweep of `src/components`, `src/hooks` and
`main.jsx` finds only `useState`/`useEffect`/`useLayoutEffect`/`useRef`/`useMemo`/`useCallback`/
`useReducer`, `createRoot` and `StrictMode` — **no portals, no `Suspense`, no `React.lazy`, no
`flushSync`, no `useSyncExternalStore`, no concurrent features**. All of it is `preact/compat`
territory.

**The gate is the test suite, and it is a good one.** 668 tests, including `App.ui.test.jsx` under
jsdom with `@testing-library/react` and `user-event`. Alias it, run `npm test`, and read the
result:

- All green → ship it; the alias is one line to revert.
- `App.ui.test.jsx` fails → do not fight it. Revert and take the Phase 1 wins.

Watch specifically for: `dangerouslySetInnerHTML` on the 500 KB backdrop, event delegation
differences around the editor's `elementFromPoint` hover hit-testing, and `useLayoutEffect`
ordering in `useEditorSync` (the scroll re-mirror in `useIsoLayoutEffect(..., [html])` is timing
-sensitive by design). **None of the logic layer is affected** — that seam is exactly what makes
this experiment cheap.

### 2.2 Stop extracting both buffers synchronously on mount

Measured above: ~150 ms of blocking work before first paint on a restored two-buffer session,
before React has rendered anything.

The fix is small and lives in one place. Give `useDebounced` an `initial` option so the first
render sees `''` and the restored text arrives via the first effect — the shell paints
immediately and results fill in one frame later. Better still, prioritise: extract the **active**
mode's buffer eagerly and the **inactive** one in a `requestIdleCallback`, since the inactive
buffer only feeds the cross-reference section.

Both are compatible with the static shell in 1.3: the shell paints, React mounts over it, and the
document's highlights arrive a frame after that instead of gating everything.

---

## Phase 3 — interaction on large documents (design work)

### 3.1 The backdrop is the real interaction cost

**11,704 `<mark>` elements and 500 KB of HTML** for a 112 KB document, re-parsed by the browser on
every settled keystroke. This is what the known-limitations list means by "no virtualization", and
it is the dominant cost of typing in a real patent application.

**(a) Window the backdrop — recommended first.** Emit marks only for the visible slice plus a
margin; emit everything outside it as plain escaped text. The character stream is unchanged, so
the alignment invariant (`strip-marks ≡ esc(text)`, already asserted in `buildHtml.test.js`)
holds exactly. Re-slice on scroll — `useEditorSync` and `backdropScroll` already instrument
scroll properly, including the elastic-overscroll case, so the plumbing exists.

Guard it in `perf.test.js` with an assertion that mark count is bounded by viewport size rather
than document length — a pure-logic property of `buildHtml`, testable in node with no DOM.

**(b) CSS Custom Highlight API — a spike, not a commitment.** `CSS.highlights` paints ranges with
**zero DOM**. It would delete the backdrop layer outright and with it the scroll mirroring, the
trailing-newline sentinel, and the `overscroll-behavior` workaround — a large simplification of
some of the fiddliest code in the app. Support is Chrome/Edge 105+, Safari 17.2+, Firefox 140+,
so a fallback path is required, which means carrying both implementations. Worth a timeboxed
spike; do (a) first regardless, since (a) is strictly smaller and works everywhere.

### 3.2 Bound the sidebar

1,088 cards mount for that same document. The cards are already `React.memo`'d, so the cost is
mount, not update — a per-section cap (say 200) with a "show all N" affordance is cheap and
removes most of it. Virtualization is the heavier alternative and probably unnecessary.

### 3.3 Steal the integer-unit layout discipline

os8088 derives every metric from one unit. `styles.css` is not far off this already, but a pass
that pins the editor's `line-height` and the card metrics to integer pixel values would remove
sub-pixel reflow between the two editor layers — the place where a fractional line-height is most
visible, because two independently-laid-out layers must agree line for line.

---

## What not to do

- **Do not move extraction to a Web Worker.** Already considered and rejected on the record, and
  the numbers still support that: post-optimization extraction sits inside the 200 ms debounce.
  After 2.2 the boot case is handled too. A worker would add a serialization boundary around the
  ExtractResult for no measured gain.
- **Do not restructure the service-worker install into blocking/non-blocking phases.** It looks
  attractive (`addAll` currently covers ~191 KB) but opportunistic caching was already a real bug
  here — the app became offline-capable on the _second_ visit. The install does not block the
  page's first paint anyway; it registers on `load`. **Shrink the payload instead** (Phase 1), which
  fixes the install cost as a side effect and cannot regress the offline guarantee.
- **Do not move hosting for cache headers.** os8088 is on Cloudflare Workers; GitHub Pages will not
  set `immutable`. But the service worker already serves every hashed asset cache-first with no
  revalidation, which is what those headers would buy. No gain, real migration cost.
- **Do not add preconnect/dns-prefetch.** There are no third-party origins — fonts are self-hosted,
  the bee is vendored, there is no analytics. On this axis the tool already matches os8088.

## Sequencing

| Phase | Work                                                                               | Risk   | Expected result                                       |
| ----- | ---------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| **1** | 1.1–1.7: fonts, inline CSS, static shell, preload, defer bee, vendor split, budget | Low    | 176.6 KB → ~87 KB, 9 → 3 requests, paint from HTML    |
| **2** | 2.1 Preact spike (gated on 668 tests) · 2.2 deferred boot extraction               | Medium | ~87 KB → ~47 KB; −150 ms before first paint           |
| **3** | 3.1 windowed backdrop · 3.2 sidebar cap · 3.3 integer units                        | Higher | Typing in a 100 KB document stops being the slow case |

Phase 1 is worth doing on its own merits whatever happens to 2 and 3. Every step is independently
revertible, and none of them touch `logic/` or the `.docx` pipeline.

## Offline guarantee — how each step interacts with it

The constraint is that the tool works after one visit with the network off. Checked step by step:

| Step                    | Effect on offline                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 fewer/smaller fonts | Strictly better — less to precache                                                                                                                  |
| 1.2 inline CSS          | Better — one fewer entry that can miss                                                                                                              |
| 1.3 static shell        | Neutral; the shell is inside the precached `index.html`                                                                                             |
| 1.4 preload             | Neutral                                                                                                                                             |
| 1.5 defer bee           | **Requires** keeping the chunk + svg in `PRECACHE` — same rule as `.docx`                                                                           |
| 1.6 vendor split        | Both chunks must enter `PRECACHE`; `swPrecache.js` derives it from the emitted asset list, so this is automatic — assert it in `swPrecache.test.js` |
| 1.7 budget              | Neutral                                                                                                                                             |
| 2.1 Preact              | Neutral (smaller bundle)                                                                                                                            |
| 2.2 deferred extraction | Neutral — runtime only, no new network work                                                                                                         |
| 3.1 windowed backdrop   | Neutral — runtime only                                                                                                                              |

The one rule to hold onto: **anything lazily loaded stays in the precache list.** That is what
makes deferral safe here, and it is already the documented reason the `.docx` chunk is listed.

## Sources

- [os8088 — colophon](https://os8088.com/colophon/) · [os8088.com](https://os8088.com/) ·
  [os8088 FAQ](https://os8088.com/faq/) · [jggonz/os8088](https://github.com/jggonz/os8088)
