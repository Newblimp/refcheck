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
    constants.js        EXCL list, article/ordinal sets, likelySign, isClaimNumber
    stem.js             stemEn / stemDe / stem (Porter EN, Snowball DE)
    tokenize.js         tokenize()
    extract.js          detectOrdStems, extractData, classify, getAllErrors
    buildHtml.js        esc, buildHtml, findAtPos
    crossref.js         computeCrossRef (Description ↔ Claims comparison)
    *.test.js           Vitest unit tests for the above
  components/           React components
    App.jsx             Main application state and layout
    SignCard.jsx        A reference sign with its associated terms
    ArtCard.jsx         Article-usage errors
    BareCard.jsx        Missing-sign (bare term) errors
    NumCard.jsx         Claim-numbering errors
    CtxMenu.jsx         Right-click context menu
    App.smoke.test.jsx  Server-render smoke test for the whole UI
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
| `stemEn()` / `stemDe()` | `logic/stem.js` | Language-specific word stemming |

## Features

### Modes
- **Description Mode**: Validates sign-term consistency throughout the text; each mode maintains its own text buffer
- **Claims Mode**: Additionally checks that signs are wrapped in parentheses `(10)`
- Mode buttons show a dot indicator when their buffer contains text

### Cross-reference
- When both Description and Claims buffers have content, a **Cross-reference** section appears in the sidebar listing signs present in one buffer but absent from the other

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
- **Reset all** button (bottom-right, fixed) clears multi-word overrides and dismissed errors

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
  extractData() ──> {signData, termData, artErrors, bareTerms, numErrors}
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

## Known Limitations / Potential Improvements

### Data Persistence
- [ ] Text content is not persisted — lost on page refresh
- [ ] Consider adding `localStorage` persistence or file save/load

### Export Features
- [ ] No way to export results or generate reports
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
- [ ] Large documents may cause lag (no virtualization)
- [ ] Consider debouncing text input for very large documents

### Additional Languages
- [ ] French patent applications are common
- [ ] Could add support for other European languages

### Sign Detection
- [ ] Detects 1–5 digit numbers (1–99999) with optional trailing letter (e.g. `12a`)
- [ ] Letter-prefix signs (A10, B12) are not yet supported
- [ ] Signs without a preceding term are currently ignored
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
- Vitest (tests)
- Google Fonts: Space Grotesk, JetBrains Mono (loaded in `index.html`)

### Testing
Unit tests live alongside the logic in `src/logic/*.test.js` and a UI render smoke test
in `src/components/App.smoke.test.jsx`. Run with `npm test` (currently **91 tests**).
Coverage by area:

| File | Covers |
|------|--------|
| `tokenize.test.js` | word/number spans, trailing-letter signs (`12a`), German letters/hyphens, >5-digit runs, glued word+number, decimals |
| `stem.test.js` | EN Porter steps (`-s`/`-ies`/`-ing`/`-ed`/`-tion`, `-ss` retention, short words), DE Snowball (plurals, umlaut folding, case), dispatch + EN fallback |
| `constants.test.js` | `likelySign` range + trailing letter, `isClaimNumber` (`.`/`)`, indented, parens, mid-sentence, no terminator), article/ordinal helpers |
| `extract.test.js` | sign/term consistency, sign↔term inconsistencies, claims parentheses, claim-numbering (sequential, out-of-order, `)`-style, leading-number guard), article errors (EN + DE first-def/repeat-indef), **DE gender conflict**, **ordinal multi-word auto-detect**, **manual `mwo` override**, bare terms (flagged/suppressed/sign-recording), trailing-letter/standalone signs, `getAllErrors` aggregation + dismissal of all four categories |
| `crossref.test.js` | null/agreement cases, missing-in-desc/claims, numeric sort, sign conflicts, term conflicts |
| `buildHtml.test.js` | empty input, warn/data-sign marks, numbering highlight, dismissed→`h-dis`, focus class, HTML escaping, non-overlapping marks; `findAtPos` sign/article/null |

Known untested area: the React UI is only exercised by a server-render smoke test
(`App.smoke.test.jsx`); interactive behaviour (hover, navigation, context menu) has no
DOM-level tests because the Vitest environment is `node`, not `jsdom`.

Manual smoke test — `npm run dev`, then paste into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Expected: Signs 10, 12, 14, 18 appear in the sidebar as "Consistent". Pasting
`The housing 12 is connected to the casing 12.` should flag sign 12 as an
inconsistency showing both "housing" and "casing".
