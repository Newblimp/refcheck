# Reference Sign Checker (RefSign Checker)

A browser-based tool for validating reference sign consistency in patent applications. Built as a single-file React application.

## Purpose

Patent documents must maintain strict consistency between reference signs (numerical identifiers like `10`, `12a`, `14`) and their associated terms (like "housing", "cover", "device"). This tool helps patent drafters identify:

1. **Inconsistent sign-to-term mappings** - Same sign used with different terms
2. **Inconsistent term-to-sign mappings** - Same term associated with different signs
3. **Article usage errors** - Incorrect use of definite ("the") vs indefinite ("a"/"an") articles
4. **Claims formatting** - Reference signs not enclosed in parentheses (required in claims)

## Architecture

Single HTML file (`index.html`) containing:
- Inline CSS with CSS custom properties for theming
- React 18 application compiled via Babel standalone
- No build step required - runs directly in browser

### Key Components

| Component | Location (line) | Purpose |
|-----------|-----------------|---------|
| `App` | 555 | Main application state and layout |
| `SignCard` | 483 | Displays a reference sign with its associated terms |
| `ArtCard` | 535 | Displays article usage errors |
| `CtxMenu` | 462 | Right-click context menu |

### Core Functions

| Function | Location (line) | Purpose |
|----------|-----------------|---------|
| `tokenize()` | 288 | Splits text into word/number tokens |
| `extractData()` | 310 | Extracts signs, terms, and article usage |
| `classify()` | 395 | Determines if a sign has errors |
| `buildHtml()` | 422 | Generates highlighted HTML for the backdrop |
| `stemEn()` / `stemDe()` | 257, 276 | Language-specific word stemming |

## Features

### Modes
- **Description Mode**: Validates sign-term consistency throughout the text
- **Claims Mode**: Additionally checks that signs are wrapped in parentheses `(10)`

### Languages
- **English (EN)**: English article rules (a/an vs the)
- **German (DE)**: German article rules with gender consistency checking (der/die/das)

### Theme
- **Light / Dark / System**: Theme preference stored in `localStorage` (`rsc_theme`)

### Error Management
- Click errors in sidebar to navigate to occurrence in text
- Use arrow buttons in status bar to cycle through errors
- Dismiss individual errors or all errors
- Right-click context menu for advanced options

### Multi-word Terms
- Auto-detects ordinal patterns ("first bearing", "second bearing")
- Manual override via context menu "Extend term" / "Reduce term"
- Settings stored in `localStorage` (`rsc_mwo`)

## Data Flow

```
User Input (textarea)
       |
       v
  tokenize() ──> Array of {word, start, end}
       |
       v
  extractData() ──> {signData, termData, artErrors}
       |
       v
  classify() ──> 'warn' | 'ok' for each sign
       |
       v
  buildHtml() ──> Highlighted HTML for backdrop overlay
```

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `rsc_theme` | Theme preference: `'light'`, `'dark'`, or `'system'` |
| `rsc_mwo` | Multi-word override settings (JSON object mapping stems to extra word counts) |

## Known Limitations / Potential Improvements

### Data Persistence
- [ ] Text content is not persisted - lost on page refresh
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
- [ ] Some highlight colors in `.h-wt` class (line 75) use hardcoded oklch values
- [ ] Some inline styles don't respect theme variables

### i18n
- [ ] "All consistent" message (line 732) is hardcoded in English
- [ ] Theme toggle labels ("Light", "System", "Dark") are not localized

### Mobile / Responsive
- [ ] Fixed sidebar width (360px) doesn't adapt to small screens
- [ ] Editor/sidebar layout should stack on mobile

### Performance
- [ ] Large documents may cause lag (no virtualization)
- [ ] Consider debouncing text input for very large documents

### Additional Languages
- [ ] French patent applications are common
- [ ] Could add support for other European languages

### Sign Detection
- [ ] Currently only detects 1-3 digit numbers (10-999)
- [ ] Some patents use 4-digit signs or letter prefixes (A10, B12)
- [ ] Signs without preceding terms are currently ignored

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
Open `index.html` in a browser and paste sample patent text:

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
