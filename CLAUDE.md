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
                        disKey (the dismissal-key scheme — never build "s:…" by hand)
    stem.js             stemEn / stemDe / stem (Porter EN, Snowball DE); stem() is
                        memoized (patent vocabulary is tiny, so this halves extraction)
    tokenize.js         tokenize() (module-level regex, lastIndex reset per call)
    extract.js          detectOrdStems, extractData, classify, getAllErrors;
                        JSDoc typedefs for the ExtractResult shape live at the top
    claims.js           segmentClaims / parseClaimRefs / computeClaimGraph — claim
                        spans, dependency refs (single, lists, ranges, "preceding
                        claims", EN+DE), transitive ancestors, depErrors
    buildHtml.js        esc, buildHtml, findAtPos (buildHtml appends a trailing
                        newline sentinel so the backdrop and textarea share a
                        scrollHeight — see the trailing-newline note below)
    crossref.js         computeCrossRef (Description ↔ Claims comparison)
    reflist.js          buildRefList / toPlainText (reference numeral list)
    *.test.js           Vitest unit tests for the above
  hooks/
    useDebounced.js     Debounce hook (defers extraction on large docs; a delay of
                        0 passes the value through with zero extra renders)
    usePersistentState.js  useState + localStorage (codecs: jsonCodec/setCodec/oneOf)
    useTheme.js         Theme preference + <html data-theme> application
    useFileDrop.js      Window-level file drag/drop (preventDefault on dragover +
                        drop, or the browser opens the file instead of the app)
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
    App.smoke.test.jsx  Server-render smoke test (node env)
    App.ui.test.jsx     Interactive DOM tests (jsdom env)
```

### Core Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `tokenize()` | `logic/tokenize.js` | Splits text into word/number tokens |
| `extractData()` | `logic/extract.js` | Extracts signs, terms, article usage, bare terms, numbering + dependency errors |
| `classify()` | `logic/extract.js` | Determines if a sign has errors |
| `getAllErrors()` | `logic/extract.js` | Collects all error positions for navigation — signature `(result, mode, dis)` |
| `computeClaimGraph()` | `logic/claims.js` | Claim spans, dependency refs, transitive ancestor sets, `depErrors` |
| `buildHtml()` | `logic/buildHtml.js` | Generates highlighted HTML for the backdrop — signature `(text, result, mode, dis, focusSign)` |
| `findAtPos()` | `logic/buildHtml.js` | Finds sign/article at a given character position |
| `computeCrossRef()` | `logic/crossref.js` | Compares the Description and Claims buffers |
| `isClaimNumber()` | `logic/constants.js` | Detects a line-leading Arabic claim number (`1.`, `1)`) |
| `isSignToken()` | `logic/constants.js` | Single source of truth for what counts as a sign (Arabic **or** Roman-numeral step) |
| `compareSigns()` | `logic/constants.js` | Sign sort: all Arabic first (value, then suffix — `10'`, `10a`), all Roman steps grouped at the end (`I`/`I.1`/`II`) |
| `romanToInt()` / `signVal()` | `logic/constants.js` | Roman→integer conversion; numeric ordering value for any sign |
| `buildRefList()` | `logic/reflist.js` | Builds the sorted sign → term numeral list |
| `stemEn()` / `stemDe()` | `logic/stem.js` | Language-specific word stemming |
| `matchHeading()` | `logic/headings.js` | Classifies a line as a section heading → `{kind, lang}` (whole-line match, then short-line prefix) |
| `splitPatentDoc()` | `logic/docSplit.js` | Document model → Description/Claims buffers + `detected` report |
| `detectLang()` | `logic/detectLang.js` | Heading-derived language, falling back to stopword scoring |
| `readDocx()` / `docxXmlToParagraphs()` | `logic/docx/read.js` | `.docx` → paragraph model (the only OOXML-aware code) |
| `writeDocx()` / `planEdits()` | `logic/docx/write.js` | Writes edits back into the original file, rewriting only changed paragraphs |
| `importPatentDoc()` / `exportPatentDoc()` | `logic/importDoc.js` | The seam App.jsx calls; hides read/split/detect and round-trip-vs-fresh |

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
- Also reports **sign/term conflicts** across buffers and a `notIntroducedInDesc` category — claims signs that *do* appear in the description but only ever **bare** (without a term), i.e. never properly introduced. This is mutually exclusive with `missingInDesc` (absent entirely)

### Word (.docx) import and export
- **Drag a `.docx` anywhere onto the window**, or use the **Import .docx** button. The
  drag handlers live on `window` (`hooks/useFileDrop.js`) and `preventDefault` on both
  `dragover` and `drop` — without that the browser opens the dropped file instead,
  because the editor is a `<textarea>`. The drop overlay is `pointer-events:none` so it
  never interferes with the editor's `elementFromPoint` hover hit-testing
- **Sections are found by dedicated heading lines**, never guessed from surrounding
  prose. A paragraph qualifies only when its *entire* text is a heading (after
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
- **Language is derived from the matched headings** — a `Patentansprüche` heading *is*
  the DE signal. The claims heading wins if the two disagree; stopword scoring
  (`detectLang.js`) only runs when no heading matched at all
- **Word auto-numbered claims are reconstructed.** Numbers created by Word's list
  numbering live in `numbering.xml`, not in the text, so such claims import as
  `A device comprising…` with no `1.` — and since `isClaimNumber` needs a literal
  line-leading digit, claim segmentation, numbering, dependencies *and* antecedent
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
- The import fills both buffers without a confirm step, but overwriting non-empty
  buffers asks first (same stance as **Reset all**), and a dismissible banner reports
  what was detected plus a one-step **Undo**. Banner messages are stored as i18n *keys*
  and resolved at render time, since the import may have just changed the language
- `imported` (the source bytes + paragraph provenance) is deliberately **not**
  persisted to `localStorage` — a 200 KB document would blow the quota alongside the
  text buffers — so a refresh keeps the text but drops round-trip export

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

### Offline Support
- The app runs entirely client-side (no backend calls), so once loaded it needs the network only for the initial fetch. Two things used to break that:
  - The UI fonts (Space Grotesk, JetBrains Mono) were pulled from the Google Fonts CDN on every load. They're now **self-hosted** — the `.woff2` files live in `src/fonts/` and are `@font-face`-declared with relative `url()`s in `styles.css`, so Vite hashes and bundles them like any other asset (no CDN request, no external dependency at all)
  - Nothing cached the app shell itself, so a page reload with no connection would just fail. `public/sw.js` is a small hand-rolled service worker (registered from `main.jsx`, production builds only) that caches the shell: navigations go network-first with a cached-shell fallback, and hashed assets (JS/CSS/fonts) are cache-first, since a content hash never changes meaning under the same URL
  - `public/manifest.webmanifest` + `public/icon.svg` make the page installable (Add to Home Screen / desktop PWA install), which is the most reliable way to keep using it with no connection at all
- Net effect: after the first successful load, the tool keeps working fully offline — including on a hard refresh — since both the shell and its assets are already cached and no external requests remain

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

`computeCrossRef` (in `logic/crossref.js`) runs `extractData` on both buffers independently and compares sign sets.

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `rsc_theme` | Theme preference: `'light'`, `'dark'`, or `'system'` |
| `rsc_mwo` | Multi-word override settings (JSON object mapping stems to extra word counts) |
| `rsc_desc` | Description-mode text buffer (autosaved) |
| `rsc_claims` | Claims-mode text buffer (autosaved) |
| `rsc_lang` | UI/checking language: `'en'` or `'de'` |
| `rsc_mode` | Active mode: `'description'` or `'claims'` |
| `rsc_dis` | Dismissed-error keys (JSON array; see `disKey` in `constants.js`) |

All access goes through `hooks/usePersistentState.js`.

## Known Limitations / Potential Improvements

### Data Persistence
- [x] Text content persists to `localStorage` (`rsc_desc`, `rsc_claims`) and restores on refresh
- [x] Language, mode and dismissed errors persist (`rsc_lang`, `rsc_mode`, `rsc_dis`)
- [x] Word `.docx` import (drag-and-drop + file picker) and round-trip export

### Export Features
- [x] Reference numeral list with copy-to-clipboard (plain text)
- [ ] Could add CSV/JSON export of sign-term mappings
- [ ] Could add copy-to-clipboard for error summary

### Keyboard Navigation
- [ ] No keyboard shortcuts for error navigation
- [ ] Consider: `Ctrl+[` / `Ctrl+]` for prev/next error
- [ ] Consider: `Escape` to close context menu

### Accessibility
- [ ] Missing ARIA labels on interactive elements
- [ ] Screen reader support could be improved
- [ ] Focus management in context menu needs work

### Theming
- [x] Theme toggle is icon-only (sun/monitor/moon) with localized `title`/`aria-label` text (`themeLight`/`themeSystem`/`themeDark` in `i18n.js`)
- [ ] "All consistent" message is hardcoded in English

### Performance
- [x] Extraction is debounced for large documents (≥5000 chars) via `useDebounced`
- [x] `stem()` is memoized and the bare-term pass reuses precomputed per-token stems (a 166KB document extracts in ~70ms, down from ~125ms); `perf.test.js` guards against regressions
- [x] Editor hover hit-testing is throttled to one `elementFromPoint` per animation frame
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
- [x] **Roman-numeral method steps**: uppercase Roman numerals (`I`, `II`, `IX`, up to
      3999) are detected as signs, plus **substeps** written as a Roman numeral, a dot and
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
Run with `npm test` (currently **304 tests**). Logic tests run under the fast `node`
environment; only `*.ui.test.jsx` files run under `jsdom` (scoped via
`environmentMatchGlobs` in `vite.config.js`, with `src/test/setup.js` providing the
jest-dom matchers and `matchMedia`/`clipboard` stubs). Coverage by area:

| File | Covers |
|------|--------|
| `tokenize.test.js` | word/number spans, trailing-letter (`12a`) & **prime (`10'`,`10′`)** signs, **Roman steps/substeps (`II`, `I.1`) + word-fallthrough (`In`, `Die`)**, German letters/hyphens, >5-digit runs, glued word+number, decimals, **CRLF spans**, repeat-call safety |
| `stem.test.js` | EN Porter steps (`-s`/`-ies`/`-ing`/`-ed`/`-tion`, `-ss` retention, short words), DE Snowball (plurals, umlaut folding, case), dispatch + EN fallback |
| `constants.test.js` | `likelySign`, `isClaimNumber` (terminators, indented, parens, mid-sentence, none, **Roman `I.` guard**, **CRLF**), `isSignToken` (prime/letter/range, **Roman + malformed rejection**), **`romanToInt`/`signVal`**, `compareSigns` (**Roman ordering, Arabic-before-Roman grouping**), article/ordinal helpers |
| `extract.test.js` | sign/term consistency & inconsistencies, claims parentheses, claim-numbering (+ stable keys, CRLF), article errors (EN+DE), DE gender conflict, ordinal multi-word + `mwo` + `detectOrdStems` guards, bare terms, **prime signs**, **Roman step/substep signs + conflicts**, **ranges (to/bis/and/und/dash/semicolon, EN+DE, with negatives, figure-word exclusion, `bis`/`Ansprüchen` never a term)**, **parenthesised sign groups (`(6, 12; 13)` all in-parens, `(see 10)` excluded)**, **`noTermSigns`**, **bracketed paragraph numbers (`[0012]`)**, **per-claim antecedent basis**, **claim dependency errors**, `getAllErrors` (five categories, dismissal keys) |
| `claims.test.js` | `segmentClaims` spans, `parseClaimRefs` (positions, offsets, lists, range expansion, DE, "preceding claims", trailing-comma negatives), `computeClaimGraph` (transitive ancestors, range/preceding ancestry, missing/forward/self typing, duplicate keys, acyclicity) |
| `crossref.test.js` | null/agreement, missing-in-desc/claims, numeric sort, sign & term conflicts, **`notIntroducedInDesc`** |
| `buildHtml.test.js` | empty input, warn/data-sign marks, numbering + dependency highlights, dismissed→`h-dis`, focus class, escaping, non-overlapping marks, **strip-marks ≡ esc(text) + trailing-newline sentinel (alignment invariant)**, **trailing-newline sentinel appended (vertical alignment)**; `findAtPos` |
| `reflist.test.js` | `buildRefList` (sort, dominant term, primes, empty), `toPlainText` |
| `headings.test.js` | normalization (leading `III.`/`B)` labels, trailing colon, NBSP, the `I claim` guard), every dictionary entry round-tripping to its own kind, the **`BRIEF DESCRIPTION` vs `DESCRIPTION OF THE DRAWINGS` collision**, and negatives — a sentence mentioning "Ansprüche" and an over-long line must NOT match |
| `docx/read.test.js` | entity decoding, **run joining with no separator** (`hous`+`ing`), `xml:space="preserve"`, tab/br, empty paragraphs, pStyle/numPr/bold (incl. `w:val="0"`), **text-box exclusion**, **tracked insertions kept / deletions dropped**, xml spans + pPr/rPr capture, header/footer/comment parts excluded, `notZip`/`noDocument` errors |
| `docSplit.test.js` | EN + DE slicing, abstract/figure-listing/Bezugszeichenliste exclusion, heading-derived language, **auto-number synthesis** (per-`numId` counters, already-numbered left alone, multi-level flagged), no-heading and claims-only fallbacks, blank-edge trimming, and a description whose prose mentions "Ansprüchen" |
| `docx/write.test.js` | `alignLines` (same/changed/deleted/appended/inserted), `planEdits` no-op on unchanged text, round trip: edit applied, **untouched paragraphs and other zip parts byte-identical**, pPr/rPr preserved, **synthesized claim numbers stripped**, XML escaping, `<w:br/>` paragraphs, appended paragraphs, re-import equals the edit, `createDocx` |
| `detectLang.test.js` | EN/DE prose, umlaut signal, empty input, **headings beat text**, text fallback |
| `importDoc.test.js` | `fileKind` (`.docx`/`.docm`/legacy `.doc`/other), import returns buffers+lang+provenance, round-trip vs fresh export, DE fresh export heading |
| `i18n.test.js` | EN/DE key parity + matching value types |
| `perf.test.js` | extraction of a >100KB document stays well under a second (quadratic-regression guard) |
| `App.ui.test.jsx` | (jsdom) typing populates sidebar, dismiss removes warning, **collapsible card section toggles open/closed**, nav cycles, **click-to-cycle through a sign's occurrences (+ unfocus after last)**, RefList copy, persistence restore + reset, mode switching preserves buffers, cross-ref section, dependency card + dismissal, context-menu term extension, language/theme toggles + persistence, dismissed-error restore, **dropped `.docx` fills both buffers + switches language + reconstructs claim numbers**, **warnings render in the newly-detected language**, **import undo**, **legacy `.doc` rejection** |

Manual smoke test — `npm run dev`, then paste into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Expected: Signs 10, 12, 14, 18 appear in the sidebar as "Consistent". Pasting
`The housing 12 is connected to the casing 12.` should flag sign 12 as an
inconsistency showing both "housing" and "casing".
