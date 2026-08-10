# RefSign Checker — architecture review

_Structure, dataflow and processing logic; whether a big-picture restructuring is warranted._

## Verdict

**No rewrite. No re-architecture.** The load-bearing decisions in this codebase are correct, and
the parts most likely to destroy a user's work (the `.docx` round-trip) are the best-engineered
parts of it. A restructuring would put that at risk to buy very little.

There is **one** genuine structural problem, and it is narrow: the _error category_ is an axis of
change that has been smeared across nine files. Everything else worth doing is consolidation
within the existing architecture, not a change to it.

The plan in §5 is four steps, ordered by payoff-per-risk. Steps 1–3 remove roughly 200 lines,
take `App.jsx` from 1,192 lines to about 500, and turn "add a sixth error type" from a nine-file
edit into a three-file one. None of them touch the `.docx` pipeline.

## Method

All 58 non-test source files read. Baseline established before judging anything:

| Measure           | Value                              |
| ----------------- | ---------------------------------- |
| Source (non-test) | 7,578 lines across 58 files        |
| Tests             | 5,987 lines across 34 files        |
| Suite             | **649 passing, 9.84s**             |
| Largest modules   | `App.jsx` 1,192 · `extract.js` 677 |

Every claim below was measured against the tree, not inferred from the docs.

---

## 1. What is load-bearing and correct

### 1.1 The `logic/` ↔ `components/` seam

This is the single most important decision in the project and it is right. `src/logic/` is
framework-free and runs under Vitest's `node` environment; only `*.ui.test.jsx` pays for jsdom.
That is why 649 tests finish in under ten seconds — and a suite that fast is a suite that gets
run.

The seam is real, not aspirational. Verified: **nothing outside `logic/` imports `fflate` or
touches OOXML.** The only match in `components/` and `hooks/` is a comment explaining the lazy
import. A layering rule that actually holds is rarer than one that is merely documented.

### 1.2 The `.docx` export's three guards

This is the strongest engineering in the repository, and the reasoning behind it is the kind
that usually has to be reconstructed years later from a post-mortem:

1. **Disjoint by construction** — `docSplit.js` clips every section against every _located_
   section, so two buffers can never name one paragraph.
2. **Refusal over corruption** — `orderSplices` throws `DocxError('spliceOverlap')` rather than
   applying a set it cannot apply safely. The comparator is written as a subtraction
   specifically because `? -1 : 1` is not a total order.
3. **Verification that does not need to know the failure mode** — `verifyExport` re-runs the
   entire import pipeline over the produced bytes and diffs them against the buffers. Guards 1
   and 2 each answer a bug someone already found; this one answers the bugs nobody has found
   yet.

Plus `xmlText.js` as the sole producer of `<w:t>` content, because escaping `& < >` is not enough
for text pasted out of a PDF.

**Do not restructure this.** Layered defence where each layer answers a different class of
failure is exactly right for an irreversible operation on someone's patent application.

### 1.3 Consolidations already made

`constants.js` (`disKey`, `CONNECTOR_ALT`, `SIGN_RE`, `CLAIM_NUM_PREFIX_RE`), `escape.js`,
`blankEdges.js`, `errorSpans.js` — each exists because two copies of a rule had drifted, and each
documents the drift it fixed. The instinct is correct and the follow-through is good.

### 1.4 Performance

The quadratic paths are gone and the guard is a **ratio** test, which fails on quadratic growth
regardless of runner speed — the right way to write that test. The decision to skip a Web Worker
is correctly reasoned in `CLAUDE.md`: post-optimization timings sit inside the debounce.

---

## 2. The one real structural problem: the error-category axis

Adding a sixth error type today means editing **nine files**. Measured on `dep`, the most
recently added category:

| File            | Lines touching `dep` | What they are                                       |
| --------------- | -------------------: | --------------------------------------------------- |
| `App.jsx`       |                   16 | state, 2 memos, callback, `disAll`, chip, 2 props   |
| `styles.css`    |                   10 | `--dep`, `--dep-bg`, `--dep-u` in both themes       |
| `Sidebar.jsx`   |                    9 | prop, `totalErrs` term, `Section` + card block      |
| `errorSpans.js` |                    5 | visit block, `NAV_PROP` entry                       |
| `claims.js`     |                    5 | production                                          |
| `DepCard.jsx`   |                    5 | an entire component, near-identical to three others |
| `extract.js`    |                    4 | plumbing into `ExtractResult`                       |
| `i18n.js`       |                    4 | EN + DE labels                                      |
| `buildHtml.js`  |                    1 | `HL` entry                                          |

`errorSpans.js` was the right instinct but stopped halfway. It unified the two _logic_ consumers
— `buildHtml` and `getAllErrors` — and `CLAUDE.md` accordingly says "add a sixth error type here,
not in two places." That is true of the highlighter and the navigator. It is **not** true of
`App.jsx` and `Sidebar.jsx`, where the categories remain hand-written parallel code.

Per category, `App.jsx` alone requires: an `EMPTY_RESULT` key, a destructure entry, a `visX`
search memo, a `visXActive` dismissal memo, an `onFocusX` callback, a `disAll()` line, a status
chip, an `anyActive` term, and two props. The five search memos (lines 280–350) are five copies
of one shape, each re-deriving `search.toLowerCase()` and each filtering on its own `disKey`.

This is the only place where the structure fights a change the project will plausibly see again.

### 2.1 The four near-identical card components

`ArtCard` (57), `BareCard` (46), `NumCard` (46), `DepCard` (53) — 202 lines. `BareCard`,
`NumCard` and `DepCard` are _the same component_: same `bare-card` class, same badge with
`minWidth: 36, fontSize: '12px'`, same message div with the same three inline style properties,
same dismiss button. They differ in a glyph, a colour token, and a message function. `ArtCard`
adds one sub-line.

`SignCard` is genuinely different (term chips, multi-word badges, per-term notes) and should stay
its own component.

---

## 3. The second problem: `App.jsx` is a god component

970 lines of code (1,192 with comments), holding:

- 18 state hooks (10 `useState` + 8 `usePersistentState`)
- 22 `useMemo`, 15 `useCallback`, 13 `useRef`
- 30 props handed to `Sidebar`
- 376 lines of JSX, ~150 of which are six inline `<svg>` icons

It does seven unrelated jobs: persisted preferences; extraction orchestration; search/dismissal
derivation; imperative DOM work (scroll mirroring, mark indexing, hover throttling, caret
restore); the whole `.docx` import/export flow including blob download and banner reports;
context-menu construction; and keyboard bindings.

The symptom worth naming: `textRef`, `focusRef` and `signDataRef` mirror state into refs **on
every render** so that callbacks can be stable, so that `React.memo` on the cards actually skips
work. That technique is correct, deliberate and well-documented here. But needing it three times
is the signal that the state has outgrown one component — not a reason to reach for a state
library (see §6).

---

## 4. Things that look like problems and are not

Worth stating explicitly, so a future reader does not "fix" them:

- **`extract.js` at 677 lines.** Only **417 are code**; 225 are JSDoc and rationale. It is
  already decomposed into 11 named functions with `extractData` orchestrating phases. Leave it.
- **Two extractions per change.** Both buffers are extracted whenever `lang`/`mwo`/`listIdx`
  changes. That is required — `computeCrossRef` compares them — and each is memoized per buffer.
- **The hand-rolled OOXML scanner.** Deliberate and correct: the logic tests run under `node`,
  which has no `DOMParser`, and the OOXML subset in play is tiny.
- **The hand-rolled stemmers.** No dependency, memoized per language, well tested.
- **The bee.** 147 lines of pure motion model with 193 lines of tests, `pointer-events: none`
  throughout, isolated behind a hook. It costs the architecture nothing. Keep it.
- **No virtualization.** Correct to defer; it would fight the backdrop/textarea alignment
  invariant, which is load-bearing.

---

## 5. The plan

Four steps, ordered by payoff-per-risk. **None touch the `.docx` pipeline.**

### Step 0 — Lock the baseline

`npm test` (649 green) and `npm run format:check` before and after every step. The UI tests in
`App.ui.test.jsx` already cover dismissal, nav, click-to-cycle and card rendering per category —
they are the safety net for Steps 1 and 2, and they are good enough to do this refactor behind.

### Step 1 — An error-kind registry _(the only structural change)_

New `logic/errorKinds.js` holding one row per category:

```js
export const ERROR_KINDS = [
  {
    id: 'art',
    field: 'artErrors',            // where extractData puts them
    disPrefix: 'a',                // MUST stay 'a' — see risk below
    disId: (e) => e.termStem,
    span: (e) => [e.artStart, e.artEnd],
    term: (e) => e.termStem,
    navProp: 'ae',                 // getAllErrors output key — preserve
    hl: 'h-art',                   // buildHtml class
    matches: (e, q, termData) => /* search predicate */,
    ui: { icon: '◈', color: 'art', section: 'gArt', chip: 'artLbl' },
    message: (e, t) => /* i18n call */,
  },
  // bare, num, dep …
];
```

Then rewrite as loops over the table:

- `errorSpans.js` — four hand-written visit blocks → one loop; `NAV_PROP` disappears
- `constants.js` — `disKey` derives from `disPrefix` + `disId`
- `App.jsx` — the five memo pairs → one loop; `disAll()`, the chips and the Sidebar props follow
- `Sidebar.jsx` — four `Section` + card blocks → one `.map`

Adding a category then means: produce it in `extract.js`, add one row, add i18n keys and CSS
tokens. **Nine files → three.**

**Three things a naive version of this gets wrong.** These are the reason to do it deliberately
rather than mechanically:

1. **The dismissal prefixes are a storage format.** `s:` `a:` `b:` `n:` `d:` are persisted in
   `rsc_dis` in users' browsers. They happen to be first letters; deriving them from `id` would
   work today and silently wipe every stored dismissal the moment a category is added whose
   initial collides. Carry the prefix **explicitly** in the row.
2. **`focus.key` is not uniform.** It is the sign string for `sign` and a character offset for
   every other kind. `focusCycle`, `anchorIdx` and every card's `focused={...}` comparison depend
   on that asymmetry.
3. **`getAllErrors` output keys are consumed by name.** `ae` / `bt` / `ne` / `de` are read by
   `App.jsx` and by the tests. Keep `navProp` until a separate, deliberate commit changes them.

_Effect: ~55 lines net removed; the nine-file cost collapses._

### Step 2 — One `ErrorCard`

Fold `ArtCard`, `BareCard`, `NumCard` and `DepCard` into a single memoized component driven by
the same rows. `SignCard` stays separate.

_Effect: 202 lines → ~110. Low risk; the UI tests assert rendered text and dismissal behaviour._

### Step 3 — Decompose `App.jsx` along seams that already exist

Not by line count — by the job each block does:

| New module                 | Moves out of `App.jsx`                                                            | ~Lines |
| -------------------------- | --------------------------------------------------------------------------------- | -----: |
| `hooks/useDocumentIO.js`   | `handleFile`, `doExport`, `undoImport`, `pickFile`, `imported`/`report`/`undoRef` |    170 |
| `hooks/useEditorSync.js`   | `syncScroll`, mark index, hover throttle, caret restore                           |     90 |
| `components/TopBar.jsx`    | logo, file actions, theme/mode/language toggles                                   |    150 |
| `components/StatusBar.jsx` | chips, error nav, restore button                                                  |     70 |
| `components/icons.jsx`     | the six inline `<svg>`s                                                           |     90 |

`useDocumentIO` is the valuable one: it is already logic wearing a component's clothes, and
moving it makes the import/export flow testable without mounting the app.

_Effect: `App.jsx` 1,192 → ~500, readable as "state + wiring". Total line count roughly neutral._

### Step 4 — Optional: `checkJs`

The JSDoc typedefs in `extract.js`, `claims.js` and `docx/read.js` are already precise enough to
type-check. Adding `// @ts-check` to `logic/` files plus a `jsconfig.json` buys real checking for
near-zero cost and no syntax change. A full TypeScript migration is **not** recommended (§6).

---

## 6. Explicitly not recommended

| Change                                          | Why not                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A state library (Redux/Zustand/Jotai)           | The ref-mirroring is mildly awkward but correct and documented. Step 3 removes most of the pressure. A store is a large migration for a single-screen app. |
| Full TypeScript migration                       | Large mechanical change across 92 files, and the JSDoc already delivers most of the editor-level benefit. Step 4 is the cheap 80%.                         |
| A Web Worker for extraction                     | Already correctly reasoned away in `CLAUDE.md`. Timings sit inside the 200ms debounce.                                                                     |
| Splitting `extract.js`                          | 417 code lines, already phase-decomposed. Splitting would scatter a single coherent pass.                                                                  |
| Generalizing `docx/` into a format-plugin layer | The `logic/docx/` boundary is already the right shape for a second format. Building the abstraction before `.odt` actually exists would be speculative.    |
| Restructuring the export guards                 | See §1.2. This is the part that must not break.                                                                                                            |

---

## Summary

The architecture is sound and, in the `.docx` path, unusually good. The codebase's real weakness
is not its shape but one repeated seam — the error category — plus a component that accumulated
seven jobs. Both are fixable in place, behind the existing 649-test suite, without touching
anything that guards a user's document.
