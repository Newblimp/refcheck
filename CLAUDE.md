# Reference Sign Checker (RefSign Checker)

A browser-based tool for validating reference sign consistency in patent applications. Built as a single-file React application.

## Purpose

Patent documents must maintain strict consistency between reference signs (numerical identifiers like `10`, `12a`, `14`) and their associated terms (like "housing", "cover", "device"). This tool helps patent drafters identify:

1. **Inconsistent sign-to-term mappings** - Same sign used with different terms
2. **Inconsistent term-to-sign mappings** - Same term associated with different signs
3. **Article usage errors** - Incorrect use of definite ("the") vs indefinite ("a"/"an") articles
4. **Claims formatting** - Reference signs not enclosed in parentheses (required in claims)
5. **Missing signs** - Terms that appear without their reference sign nearby
6. **Orphaned signs** - Signs present in description but not claims, or vice versa

## Architecture

Single HTML file (`index.html`) containing:
- Inline CSS with CSS custom properties for theming
- React 18 application compiled via Babel standalone
- No build step required - runs directly in browser

### Key Components

| Component | Location (line) | Purpose |
|-----------|-----------------|---------|
| `App` | 747 | Main application state and layout |
| `SignCard` | 654 | Displays a reference sign with its associated terms |
| `ArtCard` | 709 | Displays article usage errors |
| `BareCard` | 729 | Displays missing-sign (bare term) errors |
| `CtxMenu` | 633 | Right-click context menu |

### Core Functions

| Function | Location (line) | Purpose |
|----------|-----------------|---------|
| `tokenize()` | 399 | Splits text into word/number tokens |
| `extractData()` | 421 | Extracts signs, terms, article usage, and bare terms |
| `classify()` | 557 | Determines if a sign has errors |
| `buildHtml()` | 588 | Generates highlighted HTML for the backdrop |
| `getAllErrors()` | 566 | Collects all error positions for navigation |
| `findAtPos()` | 623 | Finds sign/article at a given character position |
| `stemEn()` / `stemDe()` | 295, 347 | Language-specific word stemming |

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
  extractData() ──> {signData, termData, artErrors, bareTerms}
       |
       v
  classify() ──> 'warn' | 'ok' for each sign
       |
       v
  buildHtml() ──> Highlighted HTML for backdrop overlay
                  (marks carry data-sign attribute for hover)
```

Cross-reference runs `extractData` on both buffers independently and compares sign sets.

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

### Undo/Redo
- [ ] No undo for dismiss actions
- [ ] Browser undo works for text but not for app state

## Development

No build process required. Simply edit `index.html` and refresh the browser.

### Dependencies (CDN)
- React 18.3.1
- ReactDOM 18.3.1
- Babel Standalone 7.29.0
- Google Fonts: Space Grotesk, JetBrains Mono

### Testing
Open `index.html` in a browser and paste sample patent text into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Expected: Signs 10, 12, 14, 18 should appear in sidebar as "Consistent".

To test error detection:
```
The housing 12 is connected to the casing 12.
```

Expected: Sign 12 should appear as "Inconsistency" with both "housing" and "casing" shown.

To test cross-reference: paste description text in Description mode and different signs in Claims mode. The Cross-reference section should list signs missing from each buffer.
