# RefSign Checker — performance record

_For whoever picks up performance work here next. It is a record of what was measured, what
shipped, and — mostly — **what was tried and rejected**, so the same experiments are not run a
third time. Every number below was measured on this tree; none are estimates unless labelled as
such._

**The hard constraint, above every optimisation in this file: the tool must work after one visit
with the network off.** Nothing here weakens that, and the rule that keeps it true is in
§ Rules that must hold.

---

## Where things stand

A Lighthouse 13.4.1 run against the deployed site (`nicos-refcheck.pages.dev`, desktop) scores
**performance 100**:

| Metric                  | Value                              |
| ----------------------- | ---------------------------------- |
| FCP / LCP               | 386 ms observed (318 ms simulated) |
| Total blocking time     | 0 ms                               |
| Cumulative layout shift | 0                                  |
| Requests before render  | 3                                  |
| Total transfer          | 45 KiB                             |
| Web fonts / stylesheets | 0 / 0 (both inlined or removed)    |
| Server response         | ~2 ms (Cloudflare edge)            |

Every opportunity audit is empty: no render-blocking resources, no unused CSS, no legacy or
duplicated JavaScript, no image or font work, no redirects, no preconnect candidates.

Locally, `npm run build && npm run budget`:

| Payload               | Now         | Budget |
| --------------------- | ----------- | ------ |
| Critical path (gz)    | **40.6 KB** | 50 KB  |
| Whole precached shell | **58.8 KB** | 70 KB  |

**The load axis is finished.** The remaining work in this file is interaction on large documents
(§ Open), not loading. Treat any new "make it load faster" idea as needing to beat a 100/100 page,
and check § Settled first.

### What is guarded automatically

| Guard                                 | Catches                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `npm run budget` (CI)                 | Bytes creeping back onto the critical path or into the shell            |
| `src/logic/perf.test.js`              | Superlinear extraction, via a **ratio** test that survives slow runners |
| `src/logic/palette.test.js`           | Contrast, opacity-composited text, literal colours in the stylesheet    |
| `build/swInstall.test.js`             | The shipped service worker's install, against a fake CacheStore         |
| `src/hooks/useEditorSync.ui.test.jsx` | Geometry reads at mount (the forced-reflow regression)                  |

---

## Rules that must hold

1. **Anything lazily loaded stays in the precache.** `build/swPrecache.js` derives the list from
   the emitted bundle, so this is automatic — but it is the reason deferral is safe here at all.
2. **A new lazy chunk must also be added to `LAZY` in `build/budget.js`.** Forget it and the win
   is reported as a _loss_: the bytes leave the entry chunk and are counted against the critical
   path again under their own name, plus the new chunk's overhead.
3. **Both editor layers read `var(--font-mono)`.** The invariant is "same font on both layers",
   not "same font on every machine" — the textarea and the highlight backdrop are laid out
   separately and must agree character for character.
4. **Colours go through tokens.** `palette.test.js` rejects a literal `color:` outright, because a
   non-token is outside the contrast matrix by construction. It also rejects dimming text with a
   partial `opacity`, which composites text _and_ its surface against what is behind them.
5. **Performance work has never needed to touch `logic/` or the `.docx` pipeline.** Every change
   in this file was independently revertible and stayed out of both.

---

## Settled — do not redo these

Each row was built or computed, not merely considered. The evidence is the point.

### Prerendering / a static app shell

Built exactly as it should be — top bar plus three-column frame at the app's real geometry,
verified pixel-identical to the mounted app, zero layout shift — then A/B'd in Chromium:

| First contentful paint | empty `#root` | static shell |
| ---------------------- | ------------- | ------------ |
| Fast 3G, 4× CPU        | 228 ms        | **244 ms**   |
| Slow 3G, 4× CPU        | 544 ms        | **568 ms**   |

**Consistently ~20 ms slower.** The shell adds DOM to parse and lay out _before_ the paint it was
supposed to bring forward, and the window it aimed at had already closed: with the CSS inlined and
the bundle at ~37 KB gzipped, the modulepreloaded chunks arrive and execute in the same frame the
shell would have painted in.

The general lesson is the durable part: **a static shell is a fix for a slow bundle.** Fix the
bundle and it has nothing left to do. `index.html` carries a comment saying not to add one back
without re-running that measurement — it also costs a standing obligation to keep the markup in
sync with `TopBar.jsx` and `App.jsx`.

Note this also answers the LCP question below, since the shell was pixel-identical: the same
element is largest, and it painted later.

### Removing the editor's placeholder to improve LCP

LCP's breakdown reads "element render delay: ~400 ms" against the textarea's placeholder, which
reads like the placeholder is at fault. It is not, twice over:

- The LCP **audit scores 1** (317.5 ms; "good" is under 2500 ms) and the breakdown panel is
  `informative` with its own `metricSavings: {LCP: 0}`. Lighthouse is saying there is nothing to
  take.
- "Element render delay" is TTFB → LCP paint minus resource load. The LCP element is **text**, so
  there is no resource to load and _everything_ lands in that bucket by definition. It describes a
  client-rendered app, not a slow element.

Measured anyway, 15 runs per variant at 4× CPU throttle, current build measured twice as a control:

| Build               | LCP        | LCP element                                                   |
| ------------------- | ---------- | ------------------------------------------------------------- |
| current             | **268 ms** | the placeholder (77,672 px²)                                  |
| placeholder removed | **264 ms** | `<p>` "No reference signs detected / Paste your patent text…" |
| current (control)   | **268 ms** | the placeholder                                               |

4 ms at 4× throttle, i.e. noise. LCP picks the largest element that _paints_, and everything here
paints in one commit when Preact mounts — so removing the placeholder relabels LCP onto the
next-largest element (with some irony, the sidebar's _other_ "paste your text" hint) at the same
instant, while costing the example line that teaches the sign/term concept.

### Extraction in a Web Worker

Post-optimisation extraction sits inside the 200 ms debounce, and the boot case is handled by the
deferral (§ History). A worker adds a serialization boundary around the whole `ExtractResult` for
no measured gain.

### Restructuring the service-worker install into blocking/non-blocking phases

Attractive-looking, but opportunistic caching was already a real bug here: the app became
offline-capable on the _second_ visit, not the first. The install does not block first paint
anyway — it registers on `load`. Shrink the payload instead, which fixes install cost as a side
effect and cannot regress the offline guarantee.

### Moving hosting for cache headers

The service worker already serves every hashed asset cache-first with no revalidation, which is
what `immutable` would buy. No gain, real migration cost.

### preconnect / dns-prefetch

There are no third-party origins — no web fonts, the bee sprite is vendored, no analytics.
Lighthouse's own report says "no additional origins are good candidates".

### Splitting `i18n.js` by language

It is the largest module in the eager chunk (16.1 KB, 19% of it) and half is the language the
reader will never see. But the strings are needed by the first render, so the only way to stop
shipping them is a dynamic import: ~2 KB gzipped traded for a round trip _before paint_ on a page
whose entire JS payload is 37 KB. A straight loss. (The strings **inside the help dialog** were a
different case and did move — they are behind a click. See § History.)

### `network-dependency-tree-insight` scoring 0

A false alarm. Its own reported LCP saving is 0 ms and it lists no preconnect candidates; it fires
on the mere existence of a document → JS chain.

---

## Open

Ranked by size of the number, largest first.

### 1. The backdrop on large documents — 2785 ms

A 112 KB document produces **11,704 `<mark>` elements and 500 KB of HTML**, re-parsed by the
browser on every settled keystroke. After the boot deferral the editor shows the document in
227 ms, but the highlights still take **2785 ms** to complete. This is the largest single number
left in the app and the substance of "no virtualization" in the known-limitations list.

**Window the backdrop** — emit marks only for the visible slice plus a margin, everything outside
it as plain escaped text. The character stream is unchanged, so the alignment invariant
(`strip-marks ≡ esc(text)`, already asserted in `buildHtml.test.js`) holds exactly. `useEditorSync`
and `backdropScroll` already instrument scroll properly, elastic overscroll included. Guard it in
`perf.test.js` by asserting mark count is bounded by viewport size rather than document length — a
pure-logic property of `buildHtml`, testable in node with no DOM.

**CSS Custom Highlight API** is the bigger prize and a spike, not a commitment: `CSS.highlights`
paints ranges with **zero DOM**, deleting the backdrop layer, the scroll mirroring, the
trailing-newline sentinel and the `overscroll-behavior` workaround in one go. Support is
Chrome/Edge 105+, Safari 17.2+, Firefox 140+, so a fallback means carrying both implementations.
Do the windowing first regardless — strictly smaller, works everywhere.

### 2. The sidebar on large documents — 1,088 cards

Cards are already `React.memo`'d, so the cost is mount, not update. A per-section cap (say 200)
with a "show all N" affordance is cheap and removes most of it. Virtualization is the heavier
alternative and probably unnecessary.

### 3. Deferring the analysis layer — ~6 KB gz, gated

`extract`, `stem`, `claims`, `crossref`, `reconcile` and the rest are ~21 KB raw of the eager
chunk and first paint needs none of it (boot extraction is already deferred past paint). But
splitting them into another _statically imported_ chunk moves the same bytes across two parallel
requests and wins nothing — the byte win requires a **dynamic** import, which makes extraction
async and turns App's `useMemo` results into state. A real restructuring of the data flow for
~6 KB gzipped. **Gate it on a throttled measurement, not on the byte count.**

### 4. Integer-unit layout discipline

Pinning the editor's `line-height` and the card metrics to integer pixel values would remove
sub-pixel reflow between the two editor layers — the place a fractional line-height is most
visible, because two independently-laid-out layers must agree line for line.

---

## How to measure

Everything in this file was produced with a small Playwright harness; rebuilding it each time is
the main avoidable cost of working here. The recipe:

1. Build the variants you are comparing into separate directories:
   `npm run build -- --outDir dist-before` (with the change reverted) and `npm run build`.
2. Serve each over plain HTTP from node — **not** `vite preview`, which adds its own headers.
3. Launch Chromium at `/opt/pw-browsers/chromium`, one **fresh context per run** with
   `serviceWorkers: 'block'`, and `Emulation.setCPUThrottlingRate` at 4×.
4. Collect in-page via `PerformanceObserver` (`longtask`, `paint`, `largest-contentful-paint` —
   the LCP entry carries `.element`, which is how you find out _what_ LCP actually is), and via
   CDP `Performance.getMetrics` for `LayoutDuration`, `RecalcStyleDuration`, `LayoutCount`.
5. Take **medians of 9–15 runs**, and measure one variant twice as a control. Differences under
   ~10 ms at 4× throttle are noise at this payload size.

Six things that cost real time to rediscover:

- **A local uncompressed server understates byte wins.** It measures parse and execute; the
  transfer saving is on top and only shows on a throttled network.
- **`LayoutCount` not dropping is not a failed fix.** Moving a forced layout out of a JS task does
  not remove the layout — it still has to happen. The task length is the metric, not the count.
- **FCP is the wrong instrument for the boot case.** It fires on the top bar, which paints early
  in every variant, and says nothing about when the user's _document_ appears. Poll for the
  editor's value and the backdrop's mark count instead.
- **The app's own debounced `localStorage` save (`SAVE_MS = 400`) will overwrite buffers you seed
  before a reload**, which once made a harness bimodal and briefly suggested a real win did
  nothing.
- **A deployed bundle can be mapped back to source exactly.** The Cloudflare build was
  byte-identical to a local `npm run build` (same content hash), which is what turned
  "`index-TZU0mzVT.js:14:7589`" into a specific line. Lighthouse source locations are 0-based.
- **For byte attribution, build once with `--sourcemap`** and walk the mappings to tally generated
  bytes per source module. That is where "48% of the app chunk is unused" and "`i18n.js` is 19% of
  it" came from.

---

## History

### Phases 1 and 2 — the payload and the boot

Fonts were the finding nobody had measured: **95.82 KB across six `.woff2` files, 54% of the
critical path**, more than React and the application code combined. They are gone entirely — both
faces are system stacks. Also shipped: the CSS inlined into `index.html`, the bee deferred, the
vendor chunk split (with the service worker's install carrying unchanged hashed chunks across from
the previous build's cache), a payload budget in CI, **Preact via `preact/compat`** (45.23 KB gz →
7.64 KB, viable because the API surface is plain hooks plus `createRoot`/`StrictMode` — no
portals, Suspense, `React.lazy`, `flushSync` or concurrent features), and the first extraction of a
restored buffer deferred past first paint.

| Measure                       | Before         | After       |
| ----------------------------- | -------------- | ----------- |
| Critical-path transfer        | 176.6 KB       | **42.6 KB** |
| Requests before render        | 9              | **3**       |
| Web fonts                     | 6 files, 96 KB | **0**       |
| Framework (gzipped)           | 45.23 KB       | **7.64 KB** |
| Whole precached shell         | ~191 KB        | **58.1 KB** |
| Restored doc visible (4× CPU) | 4199 ms        | **227 ms**  |
| Tests                         | 668            | **692**     |

The boot deferral was far bigger than predicted. The estimate was "~150 ms, realistically
400–600 ms", extrapolated from 77 ms per buffer of pure-logic work measured in node. In a browser
with two 112 KB buffers restored at 4× CPU throttle, **nothing at all appeared for 4199 ms** — the
node measurement missed the larger half of the cost, which is reconciling 11,704 `<mark>` elements
and 1,088 sidebar cards, and only happens in a DOM.

### Phase 4 — the Lighthouse follow-up

The run scored 100, so this was deliberately small. Three real items:

**The mount task forced the app's entire first layout.** Lighthouse reported one forced reflow,
46.2 ms of a 77.9 ms mount task, with Style & Layout (50 ms) the largest main-thread group — ahead
of script evaluation. It mapped to `syncScroll`'s `scrollTop`/`scrollHeight`/`clientHeight` read,
reached from the layout effect in `useEditorSync.js` that re-mirrors after every backdrop commit —
including the first, where both layers sit at offset 0 and there is nothing to mirror. The effect
is now gated on whether the editor has ever scrolled, which the scroll paths already know.

**~2 KB gz off the critical chunk.** The help dialog and its strings in both languages, plus the
bee's motion model — eager only because `useBee` imported `countBees` from the same file — now
load with what uses them. `logic/beeCount.js` exists solely to keep that one eager import away from
`beeFlight.js`; do not re-export it back.

**Two WCAG AA failures**, the report's only outright bugs: `#fff` on `--accent` at 2.17:1, and the
reset button's `--text-dim` on `--surface2` composited through `opacity: 0.7` down to 3.05:1.
`palette.test.js` passed both, because it compares raw tokens against surfaces and so can see
neither a literal colour nor an opacity composite. The same opacity bug was worse in the light
theme (2.79) where the run never looked, and the hover red `#e05252` failed in both (3.04 / 2.82).
The guards added for it are Rule 4 above, and each fails on the pre-fix stylesheet.

| Measure                             | Before   | After        |
| ----------------------------------- | -------- | ------------ |
| Critical path (gzipped)             | 42.6 KB  | **40.6 KB**  |
| App chunk (gzipped)                 | 29.74 KB | **27.68 KB** |
| Longest main-thread task            | 145 ms   | **138 ms**   |
| Total blocking time                 | 95 ms    | **88 ms**    |
| FCP / LCP                           | 276 ms   | **252 ms**   |
| `LayoutDuration` (renderer counter) | 64.6 ms  | **56.3 ms**  |
| Tests                               | 692      | **705**      |

Isolating the two changes (11 runs, byte trim held constant) puts the reflow gate at −5 ms longest
task, −5 ms TBT and −8 ms FCP on its own; the rest is the smaller chunk.

Verified in the browser rather than reasoned about: the help chunk is **not** fetched before an
interaction, the dialog opens with focus inside it, both fixed colours composite to the values the
palette test asserts — and an **offline reload still boots the app, runs extraction, and opens the
deferred help screen from the precache**.

### Where the original framing came from

This work started as a port of the techniques [os8088.com](https://os8088.com/colophon/)
documents in its colophon: static HTML so first paint is one round trip; body prose in whatever
face the reader's system supplies rather than a web font; the one remaining font subset to
`U+0020-007E`; the logo generated as inline SVG; heavy things (a 2.4 MB emulator) loaded only when
asked for. The principle underneath is the one worth keeping: **ship nothing you have not proven
you need, and let the first paint happen without JavaScript.**

Two of those did not survive contact with this codebase — the static shell measured slower, and
the fonts were removed outright rather than subset — but the framing is why anyone measured the
payload at all. The site itself could not be fetched from this environment; the techniques are
quoted from its colophon.
