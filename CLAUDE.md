# Reference Sign Checker (RefSign Checker)

A browser-based tool for validating reference sign consistency in patent applications. Built as a React + Vite application and deployed to GitHub Pages.

## Purpose

Patent documents must maintain strict consistency between reference signs (numerical identifiers like `10`, `12a`, `14`) and their associated terms (like "housing", "cover", "device"). This tool helps patent drafters identify:

1. **Inconsistent sign-to-term mappings** - Same sign used with different terms
2. **Inconsistent term-to-sign mappings** - Same term associated with different signs
3. **Article usage errors** - Incorrect use of definite ("the") vs indefinite ("a"/"an") articles;
   in claims mode this is a per-claim-chain **antecedent basis** check (see Article Checking)
4. **Claims formatting** - Reference signs not enclosed in parentheses (required in claims)
5. **Missing signs** - Terms that appear without their reference sign nearby
6. **Orphaned signs** - Signs present in description but not claims, or vice versa
7. **Claim dependency errors** - "according to claim N" references to nonexistent claims, forward references, and self-references
8. **Reference-list drift** - the draft's own list of reference signs disagreeing with the text
   (listed-but-unused, used-but-unlisted, or the same sign under a different term)
9. **Claim-set structure** - independent/dependent counts, multiple dependency, and the
   claim-count thresholds that attract fees

## Architecture

A React 18 + Vite project. The UI (JSX components) is separated from the pure
parsing/validation logic so the logic can be unit-tested in Node with no DOM.
Styling uses CSS custom properties for theming. The production bundle is built to
`dist/` and published to GitHub Pages by `.github/workflows/deploy.yml`. The app
runs fully client-side and is self-contained after the first load — see Offline
Support below.

```
index.html              Vite entry (HTML shell; sets initial theme to avoid FOUC;
                        links manifest.webmanifest + icon.svg)
build/
  swPrecache.js         Vite plugin: injects the built asset list + a build id into
                        dist/sw.js. Without it the worker precaches nothing and the
                        offline guarantee does not hold (see Offline Support)
public/
  sw.js                 Hand-rolled service worker: caches the app shell so the
                        tool keeps working offline after the first load
  manifest.webmanifest  PWA manifest (installable / Add to Home Screen)
  icon.svg              App icon, reused as favicon + manifest icon
src/
  main.jsx              Mounts <App/>, imports styles.css, registers sw.js (prod only)
  styles.css            All styles + self-hosted @font-face declarations
  fonts/                 Space Grotesk / JetBrains Mono .woff2 files (self-hosted,
                        no CDN dependency — bundled + hashed by Vite like any asset)
  assets/bee.svg        Noto Color Emoji bee (Google, Apache-2.0), vendored so the
                        easter egg needs no CDN either
  i18n.js               English/German UI strings (T)
  logic/                Pure, framework-free logic (unit-tested)
    headings.js         SECTION_KINDS + the EN/DE heading dictionary (DATA) and
                        matchHeading — drives .docx section detection
    docSplit.js         splitPatentDoc (document model → Description/Claims buffers)
    detectLang.js       detectLang / detectLangFromText (headings first, words second)
    importDoc.js        fileKind / importPatentDoc / exportPatentDoc (UI seam)
    docx/read.js        docxXmlToParagraphs, readDocx — the ONLY OOXML-aware reader
    docx/write.js       alignLines, planEdits, writeDocx, createDocx (round-trip export)
    docx/fixture.js     Test helper: builds real .docx bytes in memory
    constants.js        EXCL list, article/ordinal sets, likelySign, isClaimNumber,
                        SIGN_RE / ROMAN_RE / isSignToken / compareSigns (sign +
                        Roman-numeral-step pattern, romanToInt/signVal + sort),
                        disKey (the dismissal-key scheme — never build "s:…" by hand),
                        CONNECTOR_ALT / RANGE_DASHES (list+range connectors, shared by
                        the sign-list scan and the claim-reference parser — these had
                        drifted apart as two literals; do not re-declare them)
    escape.js           escapeMarkup — HTML/XML text escaping (was 3 identical copies)
    blankEdges.js       blankEdges / trimBlankEdges — the blank-line trimming rule that
                        docSplit and docx/write MUST agree on, or round-trip export
                        diffs against text the user never saw
    errorSpans.js       eachErrorSpan + getAllErrors — ONE traversal of the five error
                        categories, consumed by buildHtml AND the error navigator; add
                        a sixth error type here, not in two places
    fileKind.js         fileKind alone, so classifying a dropped file does not pull in
                        the lazily-loaded .docx chunk
    refListParse.js     parseRefList — reads a drafter's reference-sign list
    reconcile.js        reconcileRefList — diffs that list against the signs in the text
    claimStats.js       claimStats + THRESHOLDS — claim-set counts and fee thresholds
    stem.js             stemEn / stemDe / stem (Porter EN, Snowball DE); stem() is
                        memoized (patent vocabulary is tiny, so this halves extraction)
    tokenize.js         tokenize() (module-level regex, lastIndex reset per call)
    extract.js          detectOrdStems, extractData, classify; JSDoc typedefs for the
                        ExtractResult shape live at the top. extractData orchestrates
                        named phase functions (findSignGroups, computeArticleErrors,
                        findBareTerms, computeNumberingErrors) rather than inlining them
    claims.js           segmentClaims / parseClaimRefs / computeClaimGraph — claim
                        spans, dependency refs (single, lists, ranges, "preceding
                        claims", EN+DE), transitive ancestors, depErrors
    scrollSync.js       backdropScroll — splits the textarea's scroll offset into
                        the part the backdrop can scroll to and the elastic-
                        overscroll remainder it can only be translated by
    buildHtml.js        esc, buildHtml, findAtPos (buildHtml appends a trailing
                        newline sentinel so the backdrop and textarea share a
                        scrollHeight — see the trailing-newline note below)
    crossref.js         computeCrossRef (Description ↔ Claims comparison)
    reflist.js          buildRefList / toPlainText (reference numeral list)
    beeFlight.js        spawnBee / stepBee / beeGone / countBees — the easter-egg
                        bee's motion model, pure so it is unit-testable
    *.test.js           Vitest unit tests for the above
  hooks/
    useDebounced.js     Debounce hook (defers extraction on large docs; a delay of
                        0 passes the value through with zero extra renders)
    usePersistentState.js  useState + localStorage (codecs: jsonCodec/setCodec/oneOf).
                        Optional {debounce, onError}: the text buffers debounce their
                        writes and flush on pagehide/visibilitychange
    useTheme.js         Theme preference + <html data-theme> application
    useFileDrop.js      Window-level file drag/drop (preventDefault on dragover +
                        drop, or the browser opens the file instead of the app)
    useBee.js           Decides when a bee appears (rare random draw + typing "bee")
    useHotkeys.js       Window-level shortcuts. Unmodified keys are suppressed while
                        the user is typing — the editor holds focus nearly always, so
                        a bare "/" binding would make the app impossible to type in
  test/
    setup.js            Vitest setup (jest-dom + matchMedia/clipboard stubs)
  components/           React components
    App.jsx             Application state, editor pane, status bar
    Sidebar.jsx         Overview pane (stats, search, card sections) — presentational
    SignCard.jsx        A reference sign with its associated terms
    ArtCard.jsx         Article-usage / antecedent-basis errors
    BareCard.jsx        Missing-sign (bare term) errors
    NumCard.jsx         Claim-numbering errors
    DepCard.jsx         Claim-dependency errors
    RefList.jsx         Collapsible reference numeral list + copy
    CtxMenu.jsx         Right-click context menu
    DropOverlay.jsx     Drag-over affordance (pointer-events:none — the editor
                        hit-tests with elementFromPoint)
    ImportBanner.jsx    Import result + warnings + one-step Undo
    RefListCheck.jsx    Reference-list paste box + reconciliation findings
    ClaimStats.jsx      Claim-set statistics panel (claims mode)
    cardProps.js        activatable() — role/tabIndex/key handling shared by the cards
    Bee.jsx             The easter-egg bee (rAF loop writing transforms directly)
    App.smoke.test.jsx  Server-render smoke test (node env)
    App.ui.test.jsx     Interactive DOM tests (jsdom env)
```

### Core Functions

| Function                                  | Module                  | Purpose                                                                                                                     |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tokenize()`                              | `logic/tokenize.js`     | Splits text into word/number tokens                                                                                         |
| `extractData()`                           | `logic/extract.js`      | Extracts signs, terms, article usage, bare terms, numbering + dependency errors                                             |
| `classify()`                              | `logic/extract.js`      | Determines if a sign has errors                                                                                             |
| `eachErrorSpan()`                         | `logic/errorSpans.js`   | The single walk over all five error categories; `buildHtml` and `getAllErrors` both consume it                              |
| `getAllErrors()`                          | `logic/errorSpans.js`   | Collects all error positions for navigation — signature `(result, mode, dis)`                                               |
| `computeClaimGraph()`                     | `logic/claims.js`       | Claim spans, dependency refs, transitive ancestor sets, `depErrors`, and `direct` (per-claim parents, used by `claimStats`) |
| `buildHtml()`                             | `logic/buildHtml.js`    | Generates highlighted HTML for the backdrop — signature `(text, result, mode, dis, focusSign)`                              |
| `findAtPos()`                             | `logic/buildHtml.js`    | Finds sign/article at a given character position                                                                            |
| `backdropScroll()`                        | `logic/scrollSync.js`   | Splits a scroll offset into `{top, shift}` so overscroll cannot desync the highlights                                       |
| `computeCrossRef()`                       | `logic/crossref.js`     | Compares two **already-computed** extraction results (Description vs Claims)                                                |
| `isClaimNumber()`                         | `logic/constants.js`    | Detects a line-leading Arabic claim number (`1.`, `1)`)                                                                     |
| `isSignToken()`                           | `logic/constants.js`    | Single source of truth for what counts as a sign (Arabic **or** Roman-numeral step)                                         |
| `compareSigns()`                          | `logic/constants.js`    | Sign sort: all Arabic first (value, then suffix — `10'`, `10a`), all Roman steps grouped at the end (`I`/`I.1`/`II`)        |
| `romanToInt()` / `signVal()`              | `logic/constants.js`    | Roman→integer conversion; numeric ordering value for any sign                                                               |
| `buildRefList()`                          | `logic/reflist.js`      | Builds the sorted sign → term numeral list                                                                                  |
| `parseRefList()`                          | `logic/refListParse.js` | Parses a drafter's reference list (`10 housing`, `12 – Gehäuse`, tabs, dashes)                                              |
| `reconcileRefList()`                      | `logic/reconcile.js`    | Diffs that list against the signs actually used; stem-compared, so plurals do not false-alarm                               |
| `claimStats()`                            | `logic/claimStats.js`   | Claim-set counts, multiple dependency, DPMA/EPO claim-count thresholds                                                      |
| `stemEn()` / `stemDe()`                   | `logic/stem.js`         | Language-specific word stemming                                                                                             |
| `matchHeading()`                          | `logic/headings.js`     | Classifies a line as a section heading → `{kind, lang}` (whole-line match, then short-line prefix)                          |
| `splitPatentDoc()`                        | `logic/docSplit.js`     | Document model → Description/Claims buffers + `detected` report                                                             |
| `detectLang()`                            | `logic/detectLang.js`   | Heading-derived language, falling back to stopword scoring                                                                  |
| `readDocx()` / `docxXmlToParagraphs()`    | `logic/docx/read.js`    | `.docx` → paragraph model (the only OOXML-aware code)                                                                       |
| `writeDocx()` / `planEdits()`             | `logic/docx/write.js`   | Writes edits back into the original file, rewriting only changed paragraphs                                                 |
| `importPatentDoc()` / `exportPatentDoc()` | `logic/importDoc.js`    | The seam App.jsx calls; hides read/split/detect and round-trip-vs-fresh                                                     |
| `spawnBee()` / `stepBee()` / `beeGone()`  | `logic/beeFlight.js`    | Easter-egg bee flight: spawn off a random edge, dart around, leave                                                          |

## Features

### Modes

- **Description Mode**: Validates sign-term consistency throughout the text; each mode maintains its own text buffer
- **Claims Mode**: Additionally checks that signs are wrapped in parentheses `(10)` — a grouped list such as `(6, 12; 13)` counts as parenthesised for every sign inside it — validates claim numbering and dependencies, and switches article checking to per-claim antecedent basis
- Mode buttons show a dot indicator when their buffer contains text

### Claim dependencies (claims mode)

- `logic/claims.js` segments the buffer into claims (via the line-leading claim numbers) and parses references: `according to claim 3`, `of claim 1 or 2`, `any one of claims 1 to 4`, `nach Anspruch 3`, `nach einem der Ansprüche 1 bis 4`, and `preceding claims` / `vorhergehenden Ansprüche` phrases. EN and DE patterns are always both parsed
- **depErrors** flags references to **nonexistent** claims, **forward** references (to a later claim), and **self**-references; each carries an edit-stable dismissal key (`claim>ref#ordinal`)
- Ranges (`claims 1 to 4`) expand into intermediates for the dependency graph, but only the literally written numbers are validated/highlighted
- Bad references never create graph edges, so the ancestor computation is acyclic by construction

### Cross-reference

- When both Description and Claims buffers have content, a **Cross-reference** section appears in the sidebar listing signs present in one buffer but absent from the other
- Also reports **sign/term conflicts** across buffers and a `notIntroducedInDesc` category — claims signs that _do_ appear in the description but only ever **bare** (without a term), i.e. never properly introduced. This is mutually exclusive with `missingInDesc` (absent entirely)

### Word (.docx) import and export

- **Drag a `.docx` anywhere onto the window**, or use the **Import .docx** button. The
  drag handlers live on `window` (`hooks/useFileDrop.js`) and `preventDefault` on both
  `dragover` and `drop` — without that the browser opens the dropped file instead,
  because the editor is a `<textarea>`. The drop overlay is `pointer-events:none` so it
  never interferes with the editor's `elementFromPoint` hover hit-testing
- **Sections are found by dedicated heading lines**, never guessed from surrounding
  prose. A paragraph qualifies only when its _entire_ text is a heading (after
  stripping a leading `III.`/`B)` label and a trailing colon), which is what stops a
  sentence merely mentioning "Ansprüche" from moving a boundary. Description = after a
  `detailedDesc` heading up to the claims/sign-list; Claims = after a `claims` heading
  up to the sign-list/abstract. The abstract, figure listing and Bezugszeichenliste are
  therefore excluded by construction
- The dictionary in `logic/headings.js` is **data**: adding French means adding an `fr`
  key to each entry, with no control-flow change. Exact whole-line matches cannot
  collide, so `Brief description of the drawings` (figure listing) and `Description of
the drawings` (detailed description) coexist; the ordered prefix fallback for the
  long tail is longest-first for the same reason, and only applies to short lines
- **Language is derived from the matched headings** — a `Patentansprüche` heading _is_
  the DE signal. The claims heading wins if the two disagree; stopword scoring
  (`detectLang.js`) only runs when no heading matched at all
- **Word auto-numbered claims are reconstructed.** Numbers created by Word's list
  numbering live in `numbering.xml`, not in the text, so such claims import as
  `A device comprising…` with no `1.` — and since `isClaimNumber` needs a literal
  line-leading digit, claim segmentation, numbering, dependencies _and_ antecedent
  basis would all silently go dead. `docSplit.js` synthesizes `N. ` for
  `<w:numPr>` paragraphs (single-level decimal; deeper levels are flagged, not
  guessed) and records the prefix on the provenance handle so export strips it again
- Headers, footers, comments and footnotes are separate ZIP parts and are excluded for
  free; **text boxes** (`<w:txbxContent>`) are inline in `document.xml` and are skipped
  explicitly. Tracked insertions are kept and deletions dropped (an "all changes
  accepted" view). Legacy binary `.doc` is detected and rejected with a clear message
- **Export writes back into the original file.** Only paragraphs the user actually
  changed are rewritten (line-level diff in `docx/write.js`); every other paragraph and
  every other ZIP part stays byte-identical, so the abstract and figure listing survive
  untouched. A rewritten paragraph collapses to a single run carrying the first
  original run's `<w:rPr>`, so intra-paragraph formatting is lost **in edited
  paragraphs only** — the export button's tooltip says so. With no imported source
  (hand-pasted text) the button generates a fresh minimal `.docx` instead
- **Every exported claim lands at the same alignment as its neighbours**, because Word
  takes both the indent and the list number from the _paragraph_. Four things in
  `docx/write.js` protect that, and each was a real defect: (1) a line the diff sees as
  an **insertion becomes its own `<w:p>`**, not a `<w:br/>` folded into the paragraph
  above — a soft break inside a hanging-indent paragraph renders at the indent, so an
  inserted claim appeared shifted right and unnumbered (a line added _between_ two lines
  of one paragraph still stays inside it, since that paragraph really does span lines);
  (2) `alignLines` **never pairs a blank line with a real one**, so claim text cannot be
  written into a spacer paragraph that carries none of the claim formatting while the
  paragraph that did carry it gets deleted; (3) a new paragraph is cloned from the
  **nearest paragraph with text** (`templateNear`) rather than the neighbour, which may
  be a blank spacer, and appends land after the last paragraph the user could _see_,
  since `toText` trimmed the trailing blank ones; (4) on an auto-numbered list **any**
  leading claim number is stripped, not just the recorded `synthesizedPrefix` — an edit
  that inserts a claim renumbers the ones below it, so the paragraph whose prefix was
  `2. ` now reads `3. ` and the literal number used to survive next to Word's own.
  A cloned paragraph also drops `w14:paraId`/`w14:textId` (they must be unique) and,
  when the new line is blank, `<w:numPr>` (an empty list item still eats a claim number)
- **Exported claims keep the source's numbering style: list in → list out, typed
  numbers in → typed numbers out, nothing imported → typed numbers.** Which paragraph a
  claim line lands in is an artefact of the diff, so `conformClaim` (`docx/write.js`)
  makes it match how the section numbers claims instead: a claims section holding a
  paragraph with a `synthesizedPrefix` _is_ a Word list (the import injects one exactly
  when Word numbers the paragraph), so every claim line adopts that paragraph's `pPr`
  and gives up its typed number; otherwise no claim paragraph may carry `<w:numPr>` to
  put a second number in front of the typed one. Without this a claim written into the
  plain paragraph after the last list item — or into a `What is claimed is:` lead-in —
  kept that paragraph's shape, and the claim set came back half list, half text
- Only lines that **open with a claim number** are conformed, which is what leaves that
  lead-in alone: it is not a claim, so it must not join the list and take a number. The
  rule is opt-in per buffer (`planEdits(paras, text, {claims: true})`, set by
  `exportPatentDoc`) because a description line starting `1.` is prose, not a list item.
  Multi-level numbering (`ilvl > 0`) is left untouched — that is the case `docSplit`
  already refuses to guess at and reports via `unusualNumbering`
- The import fills both buffers without a confirm step, but overwriting non-empty
  buffers asks first (same stance as **Reset all**), and a dismissible banner reports
  what was detected plus a one-step **Undo**. Banner messages are stored as i18n _keys_
  and resolved at render time, since the import may have just changed the language
- `imported` (the source bytes + paragraph provenance) is deliberately **not**
  persisted to `localStorage` — a 200 KB document would blow the quota alongside the
  text buffers — so a refresh keeps the text but drops round-trip export

### Easter egg: the bee

- A bee occasionally flies across the window. Two triggers: a rare random draw
  (`useBee.js` runs a Bernoulli trial every 10s with p = tick/mean, so the wait is
  geometric — _memoryless_, averaging one bee every 5 minutes, rather than a fixed
  countdown), and typing the word **bee** into either buffer — or **Biene**/**Bienen**
  when the language is German. The typed trigger fires when the _count_ rises, so
  typing it twice summons two bees while merely restoring a saved buffer that already
  contains the word summons none. Switching language **re-baselines** the count instead
  of firing, so flipping to DE with "Biene" already in the buffer (or a `.docx` import,
  which changes text and language together) does not summon one
- The count is taken from **debounced** text (`SETTLE_MS`), because a mid-word keystroke
  is momentarily a complete word: typing `Bienenstock` passes through `Biene` and
  `beetle` through `bee`. Sampling only settled text means just what the user left
  standing counts
- `logic/beeFlight.js` is the pure motion model (unit-tested): the bee spawns just
  outside a random edge, steers toward a waypoint that is replaced every ~0.2–0.7s, and
  leaves through any edge after `LIFESPAN`. Roughly a quarter of waypoints are a
  **hover** (stay put and buzz on the spot). The jitter is a real acceleration of the
  same order as the steering term — that balance is what makes the track twitch and
  overshoot instead of curving smoothly. Measured in-browser: ~5 direction reversals/s,
  ~3 turns sharper than 45°/s, speed swinging 6→190 px/s, ~18% of frames hovering
- The sprite is the **Noto Color Emoji** bee, vendored into `src/assets/bee.svg` rather
  than loaded from Google, so the offline guarantee still holds
- The element is `pointer-events:none` throughout, so it can never swallow a click or
  disturb the editor's `elementFromPoint` hover hit-testing; the hover speech bubble is
  therefore triggered _geometrically_, by comparing the pointer position to the bee's
- Position is written straight to the DOM node each frame — a 60fps `setState` would
  re-render the whole app, and re-renders are the expensive part. For the same reason
  `Bee` holds `onDone` in a **ref** and runs its flight effect with `[]` deps: `onDone`
  is a fresh closure every App render, so depending on it tore the rAF loop down and
  respawned the bee off-screen on every keystroke — it never flew in while you typed
- `prefers-reduced-motion` suppresses the **random** appearances, which are the motion
  nobody asked for. Typing "bee" is an explicit by-name request and still works —
  silently doing nothing there just reads as broken
- Up to `MAX_BEES` (5) fly at once; `useBee` tracks a list of ids rather than a boolean,
  which is what makes "type it twice, get two bees" actually true

### Reference-list check (reconciliation)

- A **Reference list check** section in the sidebar takes the draft's own list of
  reference signs — pasted, or filled automatically from a `.docx` import — and diffs it
  against the signs actually used in the active buffer
- Reports **listed but never used** (usually a leftover from a deleted embodiment),
  **used but never listed**, **term mismatch** (the list says "housing", the text says
  "casing" — the one that matters), and a sign **listed twice** under two names
- Terms compare on **stems**, so "housings" in the list and "housing" in the text is a
  match, not a false alarm
- `logic/refListParse.js` is deliberately liberal about the separator (`10 housing`,
  `12 - cover`, `14\tshaft`, `16: seal`, `18) flange`) and strict about exactly one
  thing: the line must START with a reference sign, so headings and prose inside the list
  are skipped rather than guessed at
- `splitPatentDoc` already located the Bezugszeichenliste and discarded it; it now returns
  it as `signList`, which is what makes the import auto-fill work. It is still excluded
  from the description and claims buffers
- Persisted under `rsc_reflist`; cleared by **Reset all** and restored by the import
  **Undo**, alongside the text buffers

### Claim-set statistics (claims mode)

- A **Claim set** section reports total / independent / dependent counts and the longest
  dependency chain, all derived from the graph `computeClaimGraph` already builds — it
  just had to stop keeping its `direct` parent map private
- Reports **multiple dependency** (an EPO fee) and **claims depending on a
  multiply-dependent claim**, which is easy to introduce by accident deep in a chain
- Reports the claim-count thresholds that attract fees, **European practice only**: DPMA
  from the 11th claim, EPO from the 16th and again at a steeper rate from the 51st. The two
  offices are reported **independently** — the same set can sit over the DPMA limit and
  under the EPO one, and a drafter filing both wants both. The EPO's own two bands are
  exclusive, since the steeper rate replaces the first rather than adding to it
- `THRESHOLDS` in `logic/claimStats.js` holds these as **counts, not currency** — the
  amounts are revised regularly, the structure of the rules is not. There are deliberately
  no USPTO thresholds; a test asserts none are ever emitted
- A range (`any one of claims 1 to 4`) is _one_ multiply-dependent claim, not four
- **Nothing in this panel is a validation error.** A multiply-dependent claim is a
  legitimate drafting choice with a fee attached, not a mistake, so the notes render as
  information (`ⓘ`, `--info`, muted text) rather than borrowing the warning triangle the
  real error cards use — which would imply something needs fixing

### Keyboard

- `Ctrl`/`Cmd`+`[` and `Ctrl`/`Cmd`+`]` step through the errors without leaving the editor
- `/` focuses the sign filter; `Escape` closes the context menu
- Bindings **without** a modifier are suppressed while the user is typing (`useHotkeys.js`)
  — the editor is a `<textarea>` that holds focus almost all the time, so an unqualified
  `/` binding would make the app impossible to type in
- Every error card is keyboard-reachable: they carry `role="button"`, `tabIndex={0}` and
  Enter/Space handling via `activatable()` in `components/cardProps.js`. They cannot simply
  BE `<button>`s — each already contains a nested dismiss button, and nesting interactive
  elements is invalid HTML

### Reference numeral list

- A collapsible **Reference list** section in the sidebar shows the active buffer's signs in a numerically sorted `sign → term → count` table (dominant term per sign)
- **Copy** button puts a tab-separated `sign<TAB>term` list on the clipboard for pasting into a draft

### Languages

- **English (EN)**: English article rules (a/an vs the)
- **German (DE)**: German article rules with gender consistency checking (der/die/das)

### Theme

- **Light / Dark / System**: Theme preference stored in `localStorage` (`rsc_theme`)

### Error Management

- Every card section in the sidebar (Inconsistencies, Article Errors, Missing Signs, Claim numbering, Claim Dependencies, Consistent, Dismissed, Cross-reference) is **collapsible**, styled like the Reference list's own header (▾/▸ arrow, icon, label, count). Click the header to toggle; a section hides itself entirely when its count is 0 rather than being unmounted by the caller, so a toggle survives the count dropping to 0 and back. `Section` (a local helper in `Sidebar.jsx`) owns the open/closed state, defaulting to open
- Click an error card in the sidebar to jump to its occurrence in the text; clicking the **same card again cycles to the next occurrence** (document order), and the click after the last one clears the focus. A single-occurrence card (article/bare/numbering/dependency) therefore just toggles, while a multi-occurrence sign steps through all its marks. `focusCycle` in `App.jsx` owns this, keyed by an occurrence cursor (`focusOcc` ref)
- Hover a sign number in the editor to highlight its sidebar card; hover a card to highlight its marks in the editor
- Use arrow buttons in status bar to cycle through errors
- Dismiss individual errors or all errors
- Right-click context menu for advanced options
- **Reset all** button (bottom-right, fixed) clears multi-word overrides, dismissed errors **and both text buffers** (behind a confirm dialog, since it now discards typed text)

### Persistence

- Both text buffers autosave to `localStorage` (`rsc_desc`, `rsc_claims`) and are restored on load, so work survives a refresh
- **Language, mode and dismissed errors** persist too (`rsc_lang`, `rsc_mode`, `rsc_dis`) — restoring German text without also restoring the DE language setting used to produce a wall of false article errors
- All persistence goes through the `usePersistentState` hook (one place for the localStorage try/catch and codecs)
- Extraction is **debounced** for large documents (≥5000 chars) via `useDebounced`; the textarea stays immediate and the highlight backdrop is built from the same debounced buffer so spans never misalign
- The textarea and the highlight backdrop are two scroll-synced layers (`syncScroll` mirrors `scrollTop` on the textarea's `onScroll`). Because the backdrop content is debounced, a large **paste** scrolls the textarea to the caret before the taller backdrop has rendered, so the one scroll event syncs against stale, short content and the highlights sit shifted until the next manual scroll. An `useIsoLayoutEffect(() => syncScroll(), [html])` in `App.jsx` re-mirrors the scroll position after the backdrop content commits, realigning the layers before paint. `buildHtml` also appends a trailing-newline sentinel so a buffer ending in `\n` keeps both layers the same height (see Sign Detection / `buildHtml.js`)
- **Elastic overscroll used to break that mirroring at both ends of the document.** Scrolling past the top or bottom on macOS/iOS rubber-bands the textarea's content beyond its own scroll range; the backdrop clamps any offset outside `[0, scrollHeight - clientHeight]`, so the text bounced while the highlights stayed pinned to the edge of the box. `overscroll-behavior: none` on `.backdrop, .editor-ta` suppresses the rubber-band itself (it is also what stops the gesture chaining out to the page), and `syncScroll` routes through `backdropScroll` (`logic/scrollSync.js`), which splits the reported offset into the part the backdrop can scroll to and an overshoot applied as a `translateY` — the engines that _do_ surface the overscroll in `scrollTop` (iOS Safari) are then handled too. The rubber-band is a compositor effect that never reaches `scrollTop` in most engines, so the CSS line is load-bearing rather than decoration, and a unit test asserts it is still there

### Offline Support

The app runs entirely client-side (no backend calls), so once loaded it needs the network
only for the initial fetch. Three things are required for that to actually hold, and all
three are now in place:

- **The app shell is precached at install time.** `build/swPrecache.js` is a Vite plugin
  that injects the emitted asset list (plus the base URL, the manifest and the icon) into
  `dist/sw.js`, and `install` does `cache.addAll` over it. This is not optional polish:
  the service worker registers _after_ the page has already fetched its JS, CSS and fonts,
  so those requests never reach the fetch handler. A worker that only fills its cache
  opportunistically has an empty cache when the first visit ends — the app used to become
  offline-capable on the **second** visit, not the first, despite the docs claiming
  otherwise.
- **Cache lookups pass `ignoreVary`.** Static hosts (GitHub Pages, and Vite's own preview
  server) send `Vary: Origin` on assets. Entries written by `cache.addAll` carry no
  `Origin` header, but the page's own module-script and stylesheet requests are CORS-mode
  and _do_ send one — so Vary matching rejects every precached entry and the page fails to
  boot offline despite a full cache. These URLs are content-hashed, so their bytes cannot
  legitimately vary by request header. This is only findable by testing in a real browser;
  do not remove it.
- **The cache name carries a build id** derived from the asset list, so each deploy gets
  its own cache and `activate` actually evicts the previous one. A fixed name (the
  original `refcheck-shell-v1`) meant the cleanup never matched anything and every
  deploy's hashed bundles accumulated in one cache indefinitely.

Supporting pieces: the UI fonts are **self-hosted** (`src/fonts/`, `@font-face` with
relative `url()`s in `styles.css`), so Vite hashes and bundles them like any other asset
and no CDN request remains; the bee sprite is vendored for the same reason; and
`public/manifest.webmanifest` + `public/icon.svg` make the page installable.

The lazily-loaded `.docx` chunk (see Word import/export) is in the precache list too, so
a user who imports or exports for the first time while offline still gets it.

Navigations are network-first with a cached-shell fallback, so a returning-online user
picks up the latest build; unhashed assets (`icon.svg`, `manifest.webmanifest`) are
network-first too, since their contents can change under a stable URL. Everything else is
cache-first, and the offline navigation fallback resolves against the base URL — the
previous `./index.html` fallback was dead code, since the navigation is cached under
`/refcheck/`.

**Verified in Chromium**, not merely reasoned about: on a first-ever visit the shell is
precached; an offline hard reload then boots the app, runs extraction and renders the
self-hosted fonts, and a first-ever `.docx` export succeeds from the precached chunk.

### Multi-word Terms

- Auto-detects ordinal patterns ("first bearing", "second bearing")
- Manual override via context menu "Extend term" / "Reduce term"
- Settings stored in `localStorage` (`rsc_mwo`)
- Words consumed by a multi-word term are not flagged as bare-term errors

### Article Checking

- **Description mode**: flags definite articles on the **first use** of a term (should introduce with "a"/"an") and indefinite articles on **subsequent uses** (should use "the"). First use is determined by document position, not by the first occurrence that has an article
- **Claims mode (antecedent basis)**: "introduced" is evaluated **per claim chain**, not by document position. A term counts as introduced for an occurrence in claim C if it appeared earlier in C, anywhere in one of C's ancestor claims (transitive dependencies, including via ranges and "preceding claims"), or before the first claim. So a second independent claim may correctly say "a device" again, while "the seal" in a dependent claim whose chain never introduced a seal is flagged
- German gender-consistency checking (der/die/das conflicts) applies in both modes

## Data Flow

```
User Input (textarea — per-mode buffer)
       |
       v
  tokenize() ──> Array of {word, start, end}
       |
       v
  extractData() ──> {signData, termData, artErrors, bareTerms, numErrors, depErrors, noTermSigns}
       |             (claims mode also runs computeClaimGraph for deps + antecedent basis)
       v
  classify() ──> 'warn' | 'ok' for each sign
       |
       v
  buildHtml(text, result, …) ──> Highlighted HTML for backdrop overlay
                                 (marks carry data-sign attribute for hover)
```

`computeCrossRef` (in `logic/crossref.js`) takes the two **already-computed** extraction
results and compares them — App memoizes `extractData` per buffer and passes both in. It
does not run extraction itself.

## localStorage Keys

| Key           | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `rsc_theme`   | Theme preference: `'light'`, `'dark'`, or `'system'`                          |
| `rsc_mwo`     | Multi-word override settings (JSON object mapping stems to extra word counts) |
| `rsc_desc`    | Description-mode text buffer (autosaved)                                      |
| `rsc_claims`  | Claims-mode text buffer (autosaved)                                           |
| `rsc_lang`    | UI/checking language: `'en'` or `'de'`                                        |
| `rsc_mode`    | Active mode: `'description'` or `'claims'`                                    |
| `rsc_dis`     | Dismissed-error keys (JSON array; see `disKey` in `constants.js`)             |
| `rsc_reflist` | The drafter's reference-sign list, for the reference-list check               |

All access goes through `hooks/usePersistentState.js`.

## Known Limitations / Potential Improvements

### Data Persistence

- [x] Text content persists to `localStorage` (`rsc_desc`, `rsc_claims`) and restores on refresh
- [x] Language, mode and dismissed errors persist (`rsc_lang`, `rsc_mode`, `rsc_dis`)
- [x] Word `.docx` import (drag-and-drop + file picker) and round-trip export

### Export Features

- [x] Reference numeral list with copy-to-clipboard (plain text)
- [x] Reference-list **reconciliation** against the text (`logic/reconcile.js`)
- [ ] Could add CSV/JSON export of sign-term mappings
- [ ] Could add copy-to-clipboard for error summary

### Keyboard Navigation

- [x] `Ctrl`/`Cmd`+`[` / `Ctrl`/`Cmd`+`]` for prev/next error (`hooks/useHotkeys.js`)
- [x] `Escape` closes the context menu; `/` focuses the sign filter
- [x] Error cards and collapsible section headers are keyboard-activatable
- [ ] Could add a shortcut for import/export/reset

### Accessibility

- [x] ARIA labels on the error-nav buttons, editor, search box and dismiss buttons
- [x] `aria-pressed` on the language toggle, `aria-expanded` on the section headers
- [x] `main`/`complementary` landmarks; `:focus-visible` styles (there were none, and
      `.editor-ta` explicitly cleared the UA outline)
- [x] `<html lang>` follows the language setting instead of being hardcoded to `en`
- [x] `CtxMenu` has `role="menu"`, arrow-key navigation and focus restore
- [ ] Mode/theme toggle groups could use `role="radiogroup"` rather than plain buttons
- [ ] The error counts in the status bar are not in a live region

### Theming

- [x] Theme toggle is icon-only (sun/monitor/moon) with localized `title`/`aria-label` text (`themeLight`/`themeSystem`/`themeDark` in `i18n.js`)
- [x] **Both palettes clear WCAG AA (4.5:1) on every surface they render on**, guarded by
      `logic/palette.test.js`. Two tokens outright failed before: light `--accent` at
      2.66:1 (used as 10px text on the multi-word badge) and dark `--text-dim` at 2.70:1.
      Note `--surface2` is a card hover/focus background, so dim text has to clear that too
- [x] The test also pins the ramp ordering `text > text-muted > text-dim`. This is not
      hypothetical: lifting dim text far enough to pass AA on its own makes it _lighter_
      than the muted tier and inverts the hierarchy
- [x] `--info` (soft blue) for genuinely informational content — the claim-set panel, which
      must not look like an error
- [ ] "All consistent" message is hardcoded in English

### Performance

- [x] Extraction is debounced for large documents (≥5000 chars) via `useDebounced`
- [x] `stem()` is memoized (one cache per language, keyed on the raw word) and its suffix
      tables live at module scope rather than being rebuilt per call
- [x] **The quadratic scans are gone.** `extractData` had four superlinear paths; the
      worst was the sign range/list scan locating its preceding term with a `findIndex`
      from index 0. Measured on the same machine: a list-heavy 103KB description went
      133ms → 16ms, a plain 146KB one 34ms → 13ms. The others: bare-term coverage is a
      binary search over sorted ranges with a prefix-max of end offsets (an exact
      equivalent — a coverage bitmap would wrongly treat two adjacent ranges as covering
      a span neither contains); `inParensAt` binary-searches the sign groups; the
      antecedent check locates each term position's claim once
- [x] `localStorage` writes are debounced. They ran on **every keystroke**, so a 200KB
      description serialised and stored 200KB per key press — a bigger typing-latency
      source than extraction, and not covered by the extraction debounce
- [x] Hovering a sign touches only that sign's marks (indexed per backdrop render), not
      every mark in the document
- [x] `Sidebar` and the card components are `React.memo`'d, with memoized list props and
      `useCallback`'d handlers. Note the ordering: memo alone skips **nothing** until the
      props are stable identities, so all three go together or none do
- [x] The `.docx` pipeline (and fflate) is lazily imported: 227KB → 214KB initial JS,
      77KB → 70KB gzipped. Safe only because the service worker precaches the chunk
- [x] Editor hover hit-testing is throttled to one `elementFromPoint` per animation frame
- [x] `perf.test.js` covers the shapes it used to miss — a range/list-heavy corpus and a
      150-claim claims-mode set — plus a **ratio** test that fails on quadratic growth
      regardless of runner speed. The original single corpus contained no list constructs
      and never ran in claims mode, so two of the three quadratic paths were invisible to
      the guard written to catch exactly them
- [ ] Very large documents may still lag in rendering (no virtualization)
- [ ] A Web Worker for extraction was considered and deliberately not added — post-optimization timings sit comfortably inside the 200ms debounce

### Additional Languages

- [ ] French patent applications are common
- [ ] Could add support for other European languages

### Sign Detection

- The sign pattern is centralized in `constants.js` as `SIGN_RE` (Arabic) and
  `ROMAN_RE` (Roman steps); `isSignToken` accepts either, and the tokenizer and every
  extraction site share them. Sort sign lists with `compareSigns`: Arabic and Roman
  signs are **never interleaved** — all Arabic signs come first (by value, then
  suffix), all Roman steps are grouped at the end (`2`/`10`/`X`… then `I`/`I.1`/`II`).
- [x] **Bracketed paragraph numbers are ignored**: a number with a square bracket
      directly on either side (`[0012]`, `[0012]-[0015]`, `[18, 20]`) is a
      paragraph-number construct, not a sign — skipped by the main scan, ordinal
      detection and the range/list scan, and it does not satisfy a term for
      bare-term purposes (see `isBracketed` in `extract.js`)
- [x] **Cross-reference words are excluded as terms**: a number preceded by a figure/
      claim/paragraph cross-reference word (`figure 14`, `figures 14 and 15`, DE
      `Figur 14`, `Figuren 14 und 15`, `Abbildung`/`Abbildungen`/`Abb.`, `claim`,
      `paragraph`, DE claim inflections `Anspruch`/`Ansprüche`/`Ansprüchen`/`Anspruchs`,
      …) is not registered under that word — the word is in `EXCL` (`constants.js`),
      so the main scan and the range/list scan skip it. The range connectors are
      excluded too (`to` and its German parallel `bis`), so the second endpoint of
      `18 bis 22` shares the noun via range detection rather than taking `bis` as
      its term
- [x] Detects 1–5 digit numbers (1–99999) with optional trailing letter (`12a`) **and optional trailing prime (`10'`, `10′`)**; `10` and `10'` are distinct signs
- [x] **Roman-numeral method steps**: uppercase Roman numerals (`I`, `II`, `IX`, up to 3999) are detected as signs, plus **substeps** written as a Roman numeral, a dot and
      an Arabic numeral with no spaces (`I.1`, `II.2`, `IX.3`). A substep (`I.1`) is a
      distinct sign from its parent step (`I`). Only UPPERCASE Roman letters match, so
      lowercase units (`mm`, `cm`) are never mistaken for numerals, and a Roman step that
      merely starts a word (`In`, `Die`, `Vorrichtung`) falls through to the word branch.
      A line-leading Roman step (`I.`) is **not** treated as an Arabic claim number.
- [ ] An UPPERCASE word/abbreviation that is itself a valid Roman numeral (`MM`, `DC`,
      `MIX`, `DIV`) can be a false positive — but only when it directly follows a term
      word (the usual sign-to-term rule), which is rare for these; document-position and
      the preceding-term requirement keep most out of the sign list
- [x] **Sign ranges/lists** register every literally-listed sign under the shared preceding
      term: `18 to 22`, `18 bis 22`, `18 and 22`, `18 und 22`, `18–22`, `18-22`, and comma or
      **semicolon** lists of 2+ signs `18, 20` / `6, 12; 13` / `18, 20 and 22` / `18, 20, and 22`
      (Oxford), EN + DE. Digit-connector-digit adjacency keeps `a housing 12 and a cover 14`
      (distinct terms) from being misread as a list. Ranges are endpoints-only (no invented
      intermediates)
- [x] **Parenthesised sign groups**: a `(…)` (no nested parens) whose interior is only reference
      signs separated by spaces, commas or semicolons — `(10)`, `(6, 12; 13)`, `(10a, 10b)` — is a
      sign group. Every sign inside counts as written in parentheses for the claims-mode check
      (so `(6, 12; 13)` is not flagged for missing brackets), even though a `,`/`;` sits between
      the sign and the enclosing bracket. A group holding any non-sign word (`(see 10)`) does not
      qualify. See `signGroups` / `inParensAt` in `extract.js`
- [ ] Letter-prefix signs (A10, B12) are not yet supported
- [ ] A trailing comma list makes a date a false positive: `January 3, 2020` registers `2020`
      (and `3`, which the main scan already records) under the preceding word
- [ ] Signs without a preceding term are recorded in `noTermSigns` (used by cross-ref) but not shown as signs
- [ ] A sign glued to a word (`housing12`, `12housing`) is **not** tokenized at all —
      signs must be whitespace/punctuation-separated from their term to be detected

### Undo/Redo

- [ ] No undo for dismiss actions
- [ ] Browser undo works for text but not for app state

## Development

React + Vite. Common commands:

```bash
npm install      # first-time setup
npm run dev      # dev server with hot reload
npm test         # run the Vitest unit tests
npm run format   # prettier --write . (CI runs format:check before the tests)
npm run build    # production bundle → dist/
npm run preview  # serve the production build locally
```

Because the app uses native ES modules, run it through the dev/preview server (or the
live GitHub Pages site) — opening `index.html` directly from disk will not work.

### Deployment

`.github/workflows/deploy.yml` runs the tests and (on pushes to `main`) builds and
publishes `dist/` to GitHub Pages. The repo's Pages **source must be set to "GitHub
Actions"** in Settings → Pages. The Vite `base` is `/refcheck/` (project-site path).

### Dependencies

- React / ReactDOM 18.3.1 (bundled, not CDN)
- fflate (zip read/write for `.docx`; bundled, ~8KB gzipped — the only non-React runtime dep)
- Vite + @vitejs/plugin-react (build)
- Vitest (tests); jsdom + @testing-library/react + user-event + jest-dom (UI tests)
- Space Grotesk, JetBrains Mono — self-hosted `.woff2` in `src/fonts/`, no CDN (see Offline Support)

### Testing

Run with `npm test` (currently **518 tests**). Logic tests run under the fast `node`
environment; only `*.ui.test.jsx` files run under `jsdom` (scoped via
`environmentMatchGlobs` in `vite.config.js`, with `src/test/setup.js` providing the
jest-dom matchers and `matchMedia`/`clipboard` stubs). The `include` glob covers
`build/` as well as `src/`, so the service-worker precache generator is tested too.

Formatting is enforced: `.prettierrc` exists and CI runs `npm run format:check` before
the tests. Keep it green — 51 of ~55 files once violated the repo's own config because
nothing checked.

Coverage by area:

| File                             | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenize.test.js`               | word/number spans, trailing-letter (`12a`) & **prime (`10'`,`10′`)** signs, **Roman steps/substeps (`II`, `I.1`) + word-fallthrough (`In`, `Die`)**, German letters/hyphens, >5-digit runs, glued word+number, decimals, **CRLF spans**, repeat-call safety                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `stem.test.js`                   | EN Porter steps (`-s`/`-ies`/`-ing`/`-ed`/`-tion`, `-ss` retention, short words), DE Snowball (plurals, umlaut folding, case), dispatch + EN fallback, **cache transparency across an eviction and per-language isolation**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `constants.test.js`              | `likelySign`, `isClaimNumber` (terminators, indented, parens, mid-sentence, none, **Roman `I.` guard**, **CRLF**), `isSignToken` (prime/letter/range, **Roman + malformed rejection**), **`romanToInt`/`signVal`**, `compareSigns` (**Roman ordering, Arabic-before-Roman grouping**), article/ordinal helpers, **`disKey`** — the declared source of truth for dismissal keys, which had no direct test at all while every dismissal test hard-coded the literals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `extract.test.js`                | sign/term consistency & inconsistencies, claims parentheses, claim-numbering (+ stable keys, CRLF), article errors (EN+DE), DE gender conflict, ordinal multi-word + `mwo` + `detectOrdStems` guards, bare terms, **prime signs**, **Roman step/substep signs + conflicts**, **ranges (to/bis/and/und/or/oder/through/dash/semicolon, EN+DE, with negatives, figure-word exclusion, `bis`/`Ansprüchen` never a term)**, **parenthesised sign groups**, **`noTermSigns`**, **bracketed paragraph numbers (`[0012]`) — now unit-tested directly**, **per-claim antecedent basis**, **claim dependency errors**, **`autoMW = false`** (previously never exercised by any call site)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `claims.test.js`                 | `segmentClaims` spans, `parseClaimRefs` (positions, offsets, lists, range expansion, DE, "preceding claims", trailing-comma negatives), `computeClaimGraph` (transitive ancestors, range/preceding ancestry, missing/forward/self typing, duplicate keys, acyclicity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `crossref.test.js`               | null/agreement, missing-in-desc/claims, numeric sort, sign & term conflicts, **`notIntroducedInDesc`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `buildHtml.test.js`              | empty input, warn/data-sign marks, numbering + dependency highlights, dismissed→`h-dis`, focus class, escaping, non-overlapping marks, **strip-marks ≡ esc(text) + trailing-newline sentinel (alignment invariant)**, **trailing-newline sentinel appended (vertical alignment)**; `findAtPos`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scrollSync.test.js`             | `backdropScroll`: in-range pass-through, overscroll past the bottom and the top split into clamped part + shift, content shorter than the box, missing geometry (no `NaN` reaching a transform), sub-pixel exactness — plus that `styles.css` still carries `overscroll-behavior: none` on the editor layers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `reflist.test.js`                | `buildRefList` (sort, dominant term, primes, empty), `toPlainText`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `headings.test.js`               | normalization (leading `III.`/`B)` labels, trailing colon, NBSP, the `I claim` guard), every dictionary entry round-tripping to its own kind, the **`BRIEF DESCRIPTION` vs `DESCRIPTION OF THE DRAWINGS` collision**, and negatives — a sentence mentioning "Ansprüche" and an over-long line must NOT match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docx/read.test.js`              | entity decoding, **run joining with no separator** (`hous`+`ing`), `xml:space="preserve"`, tab/br, empty paragraphs, pStyle/numPr/bold (incl. `w:val="0"`), **text-box exclusion**, **tracked insertions kept / deletions dropped**, xml spans + pPr/rPr capture, header/footer/comment parts excluded, `notZip`/`noDocument` errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docSplit.test.js`               | EN + DE slicing, abstract/figure-listing/Bezugszeichenliste exclusion, heading-derived language, **auto-number synthesis** (per-`numId` counters, already-numbered left alone, multi-level flagged), no-heading and claims-only fallbacks, blank-edge trimming, a description whose prose mentions "Ansprüchen", **the sign list returned separately as `signList`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docx/write.test.js`             | `alignLines` (same/changed/deleted/appended/inserted), `planEdits` no-op on unchanged text, round trip: edit applied, **untouched paragraphs and other zip parts byte-identical**, pPr/rPr preserved, **synthesized claim numbers stripped**, XML escaping, `<w:br/>` paragraphs, appended paragraphs, re-import equals the edit, `createDocx`, **the LCS size bail-out** — note `alignLines` trims the common head and tail _before_ measuring, so a single-edit case never reaches the degraded path however long the documents are; plus **claim alignment**: an inserted claim gets its own paragraph (no `<w:br/>`) with the neighbours' `pPr`, an inserted claim on a list is numbered by Word and carries no typed number, a renumbering edit strips the typed number, an append past the end is not double-numbered, claim text never lands in a blank spacer, a clone comes from a real claim when the last paragraph is blank, an added blank line stays out of the numbering, and the file re-imports to the buffer; plus **numbering style**: a Word-list source exports every claim as a list item with no typed number left in the text (including a claim that lands in a plain trailing paragraph, and one appended past the end), a typed-number source exports no `<w:numPr>` at all, a lead-in line stays out of the list, and a numbered DESCRIPTION line is left as prose |
| `detectLang.test.js`             | EN/DE prose, umlaut signal, empty input, **headings beat text**, text fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `importDoc.test.js`              | `fileKind` (`.docx`/`.docm`/legacy `.doc`/other), import returns buffers+lang+provenance, round-trip vs fresh export, DE fresh export heading                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `beeFlight.test.js`              | spawn off each of the four edges, entering/`entered`, jagged path (heading reversals), bounded speed, lifespan → `leaving`, exit through any side, hard age cap, `countBees` (word boundary, plural, `beetle` negative, DE `Biene`/`Bienen` gated on language, `Bienenstock` negative)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `i18n.test.js`                   | EN/DE key parity + matching value types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `palette.test.js`                | contrast of every foreground token against `--bg`/`--surface`/`--surface2` in both themes at the 4.5:1 AA bar, plus the `text > muted > dim` ramp ordering. Contrast is invisible to every other kind of test, which is why two outright failures survived until now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `errorSpans.test.js`             | severity per sign, `signTerm` spans only for warned signs, a dismissed sign kept as `dis` for the backdrop while the navigator drops it, all five categories, document order, **and that every highlight class the logic emits is actually defined in `styles.css`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `reconcile.test.js`              | `parseRefList` (separator forms, multi-word terms, primed/suffixed signs, non-list lines skipped, duplicates) and `reconcileRefList` (clean list, listed-not-used, used-not-listed, term mismatch, plural/case tolerance, numeric sort, DE)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `claimStats.test.js`             | independent/dependent counts, multiple dependency, a range counting as ONE multiply-dependent claim, depends-on-multiple, chain depth, each DPMA/EPO threshold at and past its boundary, the two offices reported independently, and that **no USPTO threshold is ever emitted**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `swPrecache.test.js`             | precache list contents (base URL included, sw.js excluded, unhashed assets added, lazy chunk covered), build-id stability, and that a missing placeholder **throws** rather than shipping a worker that caches nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `usePersistentState.ui.test.jsx` | init/fallback, immediate vs debounced writes, burst coalescing, flush on pagehide and visibilitychange, quota failure reported not swallowed, private-mode degradation, all three codecs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `useHotkeys.ui.test.jsx`         | mod/Cmd equivalence, firing from inside the editor, suppression of unmodified bindings while typing, named keys, case-insensitivity, disable, handler swap without re-binding, unmount cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `useFileDrop.ui.test.jsx`        | nested dragenter/dragleave balancing, **dragleave with types hidden**, **dragend on an abandoned drag**, drop delivers the file, dragover preventDefault                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `perf.test.js`                   | a >100KB plain description, **a >100KB range/list-heavy one**, **a 150-claim claims-mode set**, and **a ratio test that fails on quadratic growth regardless of runner speed**. The original corpus had no list constructs and never ran in claims mode, so two of the three quadratic paths were invisible to it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `App.ui.test.jsx`                | (jsdom) typing populates sidebar, dismiss removes warning, **collapsible card section toggles open/closed**, nav cycles, **click-to-cycle through a sign's occurrences (+ unfocus after last)**, RefList copy, persistence restore + reset, mode switching preserves buffers, cross-ref section, dependency card + dismissal, context-menu term extension, language/theme toggles + persistence, dismissed-error restore, **dropped `.docx` fills both buffers + switches language + reconstructs claim numbers**, **import undo**, **legacy `.doc` rejection**, **the bee** (EN/DE bubble, no bee for a restored buffer, survives continued typing, beats reduced-motion on explicit request, two bees, no bee on language switch), **keyboard: Ctrl+[/] error nav, Enter/Space on a card, `/` focuses the filter but not while typing, `aria-expanded`, landmarks, `<html lang>`**, **reference-list check** (match, term mismatch, stale + missing entries, persistence, auto-fill from a `.docx`), **claim-set statistics**                                                                                                                                                                                                                                                                                                                                                                |

Manual smoke test — `npm run dev`, then paste into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Expected: Signs 10, 12, 14, 18 appear in the sidebar as "Consistent". Pasting
`The housing 12 is connected to the casing 12.` should flag sign 12 as an
inconsistency showing both "housing" and "casing".
