# refcheck

Tiny helper to check reference-sign consistency in patent applications (German and English).

A browser-based **Reference Sign Checker**: paste a patent description or claim set and it
flags inconsistent sign↔term mappings, article-usage errors, missing/orphaned signs,
claims-parentheses issues, and non-sequential claim numbering.

## Live app

Served via GitHub Pages — just open the link, nothing to install:
<https://newblimp.github.io/refcheck/>

## Development

The app is a React + Vite project. Source lives in `src/`; the production site is built
to `dist/` and published to GitHub Pages automatically by
`.github/workflows/deploy.yml` on every push to `main`.

```bash
npm install      # install dependencies (first time only)
npm run dev      # start the dev server with hot reload
npm test         # run the unit tests (Vitest)
npm run build    # produce the production bundle in dist/
npm run preview  # serve the production build locally
```

> Note: because the app uses native ES modules, open it through the dev/preview server
> (or the live Page) — opening `index.html` directly from the filesystem won't work.

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | Vite entry (HTML shell, sets the initial theme) |
| `src/main.jsx` | Mounts the React app |
| `src/styles.css` | All styles (CSS custom properties for theming) |
| `src/i18n.js` | English/German UI strings |
| `src/logic/` | Pure, framework-free logic (tokenizer, stemming, extraction, cross-reference, HTML builder, reference list) — covered by tests |
| `src/hooks/` | React hooks (`useDebounced`) |
| `src/components/` | React components (`App`, `SignCard`, `ArtCard`, `BareCard`, `NumCard`, `RefList`, `CtxMenu`) |
| `src/**/*.test.js(x)` | Vitest unit tests (logic in `node`, `*.ui.test.jsx` in `jsdom`) |

See [`CLAUDE.md`](./CLAUDE.md) for a deeper architecture overview.
