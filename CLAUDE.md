# Reference Sign Checker (RefSign Checker)

A browser-based tool for validating reference sign consistency in patent applications. Built as a React + Vite application and deployed to GitHub Pages.

## Purpose

Patent documents must maintain strict consistency between reference signs (numerical identifiers like `10`, `12a`, `14`) and their associated terms (like "housing", "cover", "device"). This tool helps patent drafters identify:

1. **Inconsistent sign-to-term mappings** - Same sign used with different terms
2. **Inconsistent term-to-sign mappings** - Same term associated with different signs
3. **Article usage errors** - Incorrect use of definite ("the") vs indefinite ("a"/"an") articles
4. **Claims formatting** - Reference signs not enclosed in parentheses (required in claims)
5. **Missing signs** - Terms that appear without their reference sign nearby
6. **Orphaned signs** - Signs present in description but not claims, or vice versa

## Architecture

A React 18 + Vite project. The UI (JSX components) is separated from the pure
parsing/validation logic so the logic can be unit-tested in Node with no DOM.
Styling uses CSS custom properties for theming. The production bundle is built to
`dist/` and published to GitHub Pages by `.github/workflows/deploy.yml`.

```
index.html              Vite entry (HTML shell; sets initial theme to avoid FOUC)
src/
  main.jsx              Mounts <App/> and imports styles.css
  styles.css            All styles
  i18n.js               English/German UI strings (T)
  logic/                Pure, framework-free logic (unit-tested)
    constants.js        EXCL list, article/ordinal sets, likelySign, isClaimNumber,
                        SIGN_RE / isSignToken / compareSigns (sign pattern + sort)
    stem.js             stemEn / stemDe / stem (Porter EN, Snowball DE)
    tokenize.js         tokenize()
    extract.js          detectOrdStems, extractData, classify, getAllErrors
    buildHtml.js        esc, buildHtml, findAtPos
    crossref.js         computeCrossRef (Description ↔ Claims comparison)
    reflist.js          buildRefList / toPlainText (reference numeral list)
    *.test.js           Vitest unit tests for the above
  hooks/
    useDebounced.js     Debounce hook (defers extraction on large docs)
  test/
    setup.js            Vitest setup (jest-dom + matchMedia/clipboard stubs)
  components/           React components
    App.jsx             Main application state and layout
    SignCard.jsx        A reference sign with its associated terms
    ArtCard.jsx         Article-usage errors
    BareCard.jsx        Missing-sign (bare term) errors
    NumCard.jsx         Claim-numbering errors
    RefList.jsx         Collapsible reference numeral list + copy
    CtxMenu.jsx         Right-click context menu
    App.smoke.test.jsx  Server-render smoke test (node env)
    App.ui.test.jsx     Interactive DOM tests (jsdom env)
```

### Core Functions

| Function | Module | Purpose |
|----------|--------|---------|
| `tokenize()` | `logic/tokenize.js` | Splits text into word/number tokens |
| `extractData()` | `logic/extract.js` | Extracts signs, terms, article usage, bare terms, numbering errors |
| `classify()` | `logic/extract.js` | Determines if a sign has errors |
| `getAllErrors()` | `logic/extract.js` | Collects all error positions for navigation |
| `buildHtml()` | `logic/buildHtml.js` | Generates highlighted HTML for the backdrop |
| `findAtPos()` | `logic/buildHtml.js` | Finds sign/article at a given character position |
| `computeCrossRef()` | `logic/crossref.js` | Compares the Description and Claims buffers |
| `isClaimNumber()` | `logic/constants.js` | Detects a line-leading claim number (`1.`, `1)`) |
| `isSignToken()` | `logic/constants.js` | Single source of truth for what counts as a sign |
| `compareSigns()` | `logic/constants.js` | Numeric-then-suffix sign sort (handles `10'`, `10a`) |
| `buildRefList()` | `logic/reflist.js` | Builds the sorted sign → term numeral list |
| `stemEn()` / `stemDe()` | `logic/stem.js` | Language-specific word stemming |

## Features

### Modes
- **Description Mode**: Validates sign-term consistency throughout the text; each mode maintains its own text buffer
- **Claims Mode**: Additionally checks that signs are wrapped in parentheses `(10)`
- Mode buttons show a dot indicator when their buffer contains text

### Cross-reference
- When both Description and Claims buffers have content, a **Cross-reference** section appears in the sidebar listing signs present in one buffer but absent from the other
- Also reports **sign/term conflicts** across buffers and a `notIntroducedInDesc` category — claims signs that *do* appear in the description but only ever **bare** (without a term), i.e. never properly introduced. This is mutually exclusive with `missingInDesc` (absent entirely)

### Reference numeral list
- A collapsible **Reference list** section in the sidebar shows the active buffer's signs in a numerically sorted `sign → term → count` table (dominant term per sign)
- **Copy** button puts a tab-separated `sign<TAB>term` list on the clipboard for pasting into a draft

### Languages
- **English (EN)**: English article rules (a/an vs the)
- **German (DE)**: German article rules with gender consistency checking (der/die/das)

### Theme
- **Light / Dark / System**: Theme preference stored in `localStorage` (`rsc_theme`)

### Error Management
- Click errors in sidebar to navigate to occurrence in text
- Hover a sign number in the editor to highlight its sidebar card; hover a card to highlight its marks in the editor
- Use arrow buttons in status bar to cycle through errors
- Dismiss individual errors or all errors
- Right-click context menu for advanced options
- **Reset all** button (bottom-right, fixed) clears multi-word overrides, dismissed errors **and both text buffers** (behind a confirm dialog, since it now discards typed text)

### Persistence
- Both text buffers autosave to `localStorage` (`rsc_desc`, `rsc_claims`) and are restored on load, so work survives a refresh
- Extraction is **debounced** for large documents (≥5000 chars) via `useDebounced`; the textarea stays immediate and the highlight backdrop is built from the same debounced buffer so spans never misalign

### Multi-word Terms
- Auto-detects ordinal patterns ("first bearing", "second bearing")
- Manual override via context menu "Extend term" / "Reduce term"
- Settings stored in `localStorage` (`rsc_mwo`)
- Words consumed by a multi-word term are not flagged as bare-term errors

### Article Checking
- Flags definite articles on the **first use** of a term (should introduce with "a"/"an")
- Flags indefinite articles on **subsequent uses** of a term (should use "the")
- First use is determined by document position, not by the first occurrence that has an article

## Data Flow

```
User Input (textarea — per-mode buffer)
       |
       v
  tokenize() ──> Array of {word, start, end}
       |
       v
  extractData() ──> {signData, termData, artErrors, bareTerms, numErrors, noTermSigns}
       |
       v
  classify() ──> 'warn' | 'ok' for each sign
       |
       v
  buildHtml() ──> Highlighted HTML for backdrop overlay
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

## Known Limitations / Potential Improvements

### Data Persistence
- [x] Text content persists to `localStorage` (`rsc_desc`, `rsc_claims`) and restores on refresh
- [ ] Consider file save/load (no import/export to disk yet)

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
- [ ] Theme toggle labels ("Light", "System", "Dark") are not localized
- [ ] "All consistent" message is hardcoded in English

### Performance
- [x] Extraction is debounced for large documents (≥5000 chars) via `useDebounced`
- [ ] Very large documents may still lag in rendering (no virtualization)

### Additional Languages
- [ ] French patent applications are common
- [ ] Could add support for other European languages

### Sign Detection
- The sign pattern is centralized in `constants.js` as `SIGN_RE` / `isSignToken`; the
  tokenizer and every extraction site share it. Sort sign lists with `compareSigns`.
- [x] Detects 1–5 digit numbers (1–99999) with optional trailing letter (`12a`) **and optional trailing prime (`10'`, `10′`)**; `10` and `10'` are distinct signs
- [x] **Sign ranges/lists** register both endpoints (endpoints-only): `18 to 22`, `18 bis 22`,
      `18 and 22`, `18 und 22`, `18–22`, `18-22`. Digit-connector-digit adjacency keeps
      `a housing 12 and a cover 14` (distinct terms) from being misread as a range
- [ ] Letter-prefix signs (A10, B12) are not yet supported
- [ ] 3+ element comma lists (`18, 20 and 22`) capture only the connector pair (18,20 / 20,22)
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
- Vite + @vitejs/plugin-react (build)
- Vitest (tests); jsdom + @testing-library/react + user-event + jest-dom (UI tests)
- Google Fonts: Space Grotesk, JetBrains Mono (loaded in `index.html`)

### Testing
Run with `npm test` (currently **120 tests**). Logic tests run under the fast `node`
environment; only `*.ui.test.jsx` files run under `jsdom` (scoped via
`environmentMatchGlobs` in `vite.config.js`, with `src/test/setup.js` providing the
jest-dom matchers and `matchMedia`/`clipboard` stubs). Coverage by area:

| File | Covers |
|------|--------|
| `tokenize.test.js` | word/number spans, trailing-letter (`12a`) & **prime (`10'`,`10′`)** signs, German letters/hyphens, >5-digit runs, glued word+number, decimals |
| `stem.test.js` | EN Porter steps (`-s`/`-ies`/`-ing`/`-ed`/`-tion`, `-ss` retention, short words), DE Snowball (plurals, umlaut folding, case), dispatch + EN fallback |
| `constants.test.js` | `likelySign`, `isClaimNumber` (terminators, indented, parens, mid-sentence, none), `isSignToken` (prime/letter/range), `compareSigns`, article/ordinal helpers |
| `extract.test.js` | sign/term consistency & inconsistencies, claims parentheses, claim-numbering, article errors (EN+DE), DE gender conflict, ordinal multi-word + `mwo`, bare terms, **prime signs**, **ranges (to/bis/and/und/dash, EN+DE, with negatives)**, **`noTermSigns`**, `getAllErrors` |
| `crossref.test.js` | null/agreement, missing-in-desc/claims, numeric sort, sign & term conflicts, **`notIntroducedInDesc`** |
| `buildHtml.test.js` | empty input, warn/data-sign marks, numbering highlight, dismissed→`h-dis`, focus class, escaping, non-overlapping marks; `findAtPos` |
| `reflist.test.js` | `buildRefList` (sort, dominant term, primes, empty), `toPlainText` |
| `App.ui.test.jsx` | (jsdom) typing populates sidebar, dismiss removes warning, nav cycles, RefList copy, persistence restore + reset |

Manual smoke test — `npm run dev`, then paste into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Expected: Signs 10, 12, 14, 18 appear in the sidebar as "Consistent". Pasting
`The housing 12 is connected to the casing 12.` should flag sign 12 as an
inconsistency showing both "housing" and "casing".
