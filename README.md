# refcheck

Tiny helper to check reference-sign consistency in patent applications (German and English).

A browser-based **Reference Sign Checker**: paste a patent description or claim set and it
flags inconsistent sign↔term mappings, article-usage errors (antecedent basis in claims
mode), missing/orphaned signs, claims-parentheses issues, claim numbering and dependency
errors. It also reconciles the draft's own list of reference signs against the text, and
reports claim-set statistics — independent/dependent counts, multiple dependency, and the
claim-count thresholds that attract DPMA and EPO fees.

The reference list is not only checked against the text but read from: the multi-word
terms it spells out ("30 control unit") are matched in the description and the claims and
applied there automatically, so a listed term is checked as the whole phrase rather than
as its last noun. Right-click a term in the text to widen or reduce it by hand.

Word `.docx` files can be dragged straight in; description and claims are found by their
headings, and edits can be written back into the original file.

## Live app

Served via GitHub Pages — just open the link, nothing to install:
<https://newblimp.github.io/refcheck/>

It runs entirely in the browser (no backend, no account) and works fully offline
after the first visit — a service worker precaches the app shell at install time, the
stylesheet is inlined into the page and there are no web fonts, so no network requests
remain once it's loaded. The whole thing is **42.6 KB over the wire across 3 requests**.
You can also install it (Add to Home Screen / desktop PWA install) for a standalone
offline app.

## Development

The app is a Preact + Vite project in **TypeScript**, written against the React API
(`preact/compat`; components import from `react` and the alias lives in `vite.config.ts`).
Source lives in `src/`; the production site is built
to `dist/` and published to GitHub Pages automatically by
`.github/workflows/deploy.yml` on every push to `main`.

```bash
npm install        # install dependencies (first time only)
npm run dev        # start the dev server with hot reload
npm test           # run the unit tests (Vitest)
npm run typecheck  # tsc over src/, build/ and the service worker (see tsconfig*.json)
npm run format     # prettier --write . (CI checks this before the tests)
npm run build      # produce the production bundle in dist/
npm run budget     # check the payload budget against dist/ (CI runs it after the build)
npm run preview    # serve the production build locally
```

CI runs `format:check`, `typecheck` and the tests on every push and pull request.

> Note: because the app uses native ES modules, open it through the dev/preview server
> (or the live Page) — opening `index.html` directly from the filesystem won't work.

## Project layout

| Path                           | Purpose                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                   | Vite entry (HTML shell, sets the initial theme)                                                                                  |
| `src/sw.ts`                    | Service worker — caches the app shell for offline use (type-stripped to `dist/sw.js`, never bundled)                             |
| `public/manifest.webmanifest`  | PWA manifest (installable / Add to Home Screen)                                                                                  |
| `src/main.tsx`                 | Mounts the app, registers the service worker                                                                                     |
| `src/styles.css`               | All styles (CSS custom properties for theming). No web fonts — `--font-ui`/`--font-mono` are system stacks                       |
| `build/`                       | Build plugins: service-worker precache list, CSS inlining, payload budget                                                        |
| `src/i18n.ts`                  | English/German UI strings                                                                                                        |
| `src/logic/`                   | Pure, framework-free logic (tokenizer, stemming, extraction, claim graph, `.docx` read/write, reference list) — covered by tests |
| `src/logic/errorKinds.ts`      | The table of error categories — the one place that knows a category exists                                                       |
| `src/hooks/`                   | Hooks (state persistence, hotkeys, file drop, editor sync, `.docx` I/O)                                                          |
| `src/components/`              | Components (`App`, `TopBar`, `StatusBar`, `Sidebar`, `SignCard`, `ErrorCard`, `RefList`, `CtxMenu`)                              |
| `src/**/*.test.ts(x)`          | Vitest unit tests (logic in `node`, `*.ui.test.tsx` in `jsdom`)                                                                  |
| `tsconfig*.json`               | The three TypeScript projects `npm run typecheck` runs                                                                           |
| `docs/architecture-review.md`  | Architecture review: what is load-bearing, and what was restructured                                                             |
| `docs/typescript-migration.md` | What the TypeScript migration changed, and what the compiler found                                                               |

See [`CLAUDE.md`](./CLAUDE.md) for a deeper architecture overview.
