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

What it must NOT report is just as much part of the job — a checker that cries wolf gets
switched off. See **Cumulative References** for the numbered-term rule ("erste Welle 10" …
"die Wellen 10, 20 und 30"), which is the clearest case of correct drafting that reads as
three errors when taken literally.

## Architecture

A Preact + Vite project, written against the React API (`preact/compat`, aliased in
`vite.config.ts` — components import from `react` and stay portable). The UI (JSX
components) is separated from the pure
parsing/validation logic so the logic can be unit-tested in Node with no DOM. That seam is
real and worth keeping real: nothing outside `logic/` imports fflate or touches OOXML,
which is why the whole suite runs in about ten seconds.
Styling uses CSS custom properties for theming. The production bundle is built to
`dist/` and published to GitHub Pages by `.github/workflows/deploy.yml`. The app
runs fully client-side and is self-contained after the first load — see Offline
Support below.

```
index.html              Vite entry (HTML shell; sets initial theme to avoid FOUC;
                        links manifest.webmanifest + icon.svg)
build/
  swPrecache.ts         Vite plugin: type-strips src/sw.ts and injects the built
                        asset list + a build id into dist/sw.js. Strip FIRST,
                        substitute second — the tokens are declared as ambient
                        constants in the source, and substituting first would
                        rewrite them inside those `declare` lines. Without this
                        plugin the worker precaches nothing and the offline
                        guarantee does not hold (see Offline Support)
  inlineCss.ts          Vite plugin: folds the stylesheet into index.html and drops
                        the .css asset, so the page needs no second request to style
                        itself. Must run BEFORE swPrecache reads the bundle keys
  budget.ts             Payload budget (npm run budget, run in CI after the build).
                        The suite guards how long extraction takes; this guards how
                        much the app ships — the axis nothing was watching
public/
  manifest.webmanifest  PWA manifest (installable / Add to Home Screen)
  icon.svg              App icon, reused as favicon + manifest icon
src/
  main.tsx              Mounts <App/>, imports styles.css, registers sw.js (prod only)
  sw.ts                 Hand-rolled service worker: caches the app shell so the
                        tool keeps working offline after the first load. NOT
                        bundled — it must ship as a classic script at a stable,
                        unhashed URL, so swPrecache.ts type-strips it with
                        esbuild and writes dist/sw.js directly
  vite-env.d.ts         Vite's ambient module declarations (asset imports, env)
  styles.css            All styles. NO web fonts: --font-ui and --font-mono are
                        system stacks (see Fonts below). Six self-hosted .woff2
                        files used to live in src/fonts/ and were 54% of everything
                        the first visit fetched
  assets/bee.svg        Noto Color Emoji bee (Google, Apache-2.0), vendored so the
                        easter egg needs no CDN either
  i18n.ts               English/German UI strings (T)
  helpText.ts           The strings INSIDE the help screen (HELP), split out of
                        i18n.ts so they load with the dialog rather than on the
                        critical path. i18n.test.ts checks both tables alike
  logic/                Pure, framework-free logic (unit-tested)
    headings.ts         SECTION_KINDS + the EN/DE heading dictionary (DATA) and
                        matchHeading — drives .docx section detection
    docSplit.ts         splitPatentDoc (document model → Description/Claims buffers).
                        Section ranges are clipped against each other so the buffers
                        are ALWAYS disjoint — export splices into the paragraphs a
                        buffer names, so two buffers naming one paragraph means one
                        section written over the other
    detectLang.ts       detectLang / detectLangFromText (headings first, words second)
    importDoc.ts        fileKind / importPatentDoc / exportPatentDoc (UI seam)
    docx/read.ts        docxXmlToParagraphs, readDocx — the ONLY OOXML-aware reader
    docx/write.ts       planEdits / orderSplices / writeDocx / createDocx — turns a
                        buffer edit into splices into document.xml and applies them
    docx/lineDiff.ts    alignLines — which imported line became which edited line.
                        Pure string work; knows nothing about OOXML or claims
    docx/claimNumbering.ts  Where a claim's number belongs in the exported file:
                        Word's list numbering vs numbers typed into the text
    docx/xmlText.ts     stripInvalidXmlChars / xmlText — the ONLY thing that may
                        produce `<w:t>` content. Escaping is not enough: pasted text
                        carries characters XML 1.0 cannot hold at all
    docx/verify.ts      verifyExport — re-reads the produced file and compares it
                        with the buffers. The one check that does not need to know
                        the failure mode in advance
    docx/fixture.ts     Test helper: builds real .docx bytes in memory; `xmlFault`
                        asserts well-formedness, which re-importing cannot (the
                        reader is a tag scanner and reads bad nesting happily)
    constants.ts        EXCL list, article/ordinal sets, likelySign, isClaimNumber,
                        CLAIM_NUM_PREFIX_RE / startsWithClaimNumber / stripClaimNumber
                        (the line-leading claim number — docSplit and the .docx writer
                        must agree on it exactly, and once did not),
                        SIGN_RE / ROMAN_RE / isSignToken / compareSigns (sign +
                        Roman-numeral-step pattern, romanToInt/signVal + sort),
                        disKey (the dismissal-key scheme — never build "s:…" by hand),
                        CONNECTOR_ALT / RANGE_DASHES (list+range connectors, shared by
                        the sign-list scan and the claim-reference parser — these had
                        drifted apart as two literals; do not re-declare them)
    escape.ts           escapeMarkup — HTML/XML text escaping (was 3 identical copies)
    blankEdges.ts       blankEdges / trimBlankEdges — the blank-line trimming rule that
                        docSplit and docx/write MUST agree on, or round-trip export
                        diffs against text the user never saw
    errorKinds.ts       ERROR_KINDS — the table of error categories, and the ONE place
                        that knows a category exists. Adding one is a new row here plus
                        its production in extract.ts, its i18n keys and its two colour
                        tokens; nothing else. Never derive the dismissal prefixes from
                        the id (they are a storage format — see Error Categories below)
    errorSpans.ts       eachErrorSpan + getAllErrors — ONE traversal of the error
                        categories, consumed by buildHtml AND the error navigator; it
                        loops ERROR_KINDS rather than naming them. Also errorGroup, the
                        "same term" bucket the Ctrl+Shift+↓/↑ jump steps within
    ctxMenuItems.ts     What the editor's right-click menu offers for whatever sits at
                        the caret. Pure, so it is testable without mounting the app —
                        deliberately per-category, NOT driven by ERROR_KINDS
    fileKind.ts         fileKind alone, so classifying a dropped file does not pull in
                        the lazily-loaded .docx chunk
    refListParse.ts     parseRefList — reads a drafter's reference-sign list
    listTerms.ts        listTermIndex / listExtra / appliedListTerms — the
                        multi-word terms that list spells out, indexed on the LAST
                        TWO words so the lookup stays O(1) on a 300-entry list
    reconcile.ts        reconcileRefList — diffs that list against the signs in the text
    claimStats.ts       claimStats + THRESHOLDS — claim-set counts and fee thresholds
    stem.ts             stemEn / stemDe / stem (Porter EN, Snowball DE); stem() is
                        memoized (patent vocabulary is tiny, so this halves extraction)
    tokenize.ts         tokenize() (module-level regex, lastIndex reset per call)
    cumulative.ts       canonicalCumulativeTerms — "eine erste Welle 10 … die Wellen
                        10, 20 und 30": which shortened terms are back-references to
                        a term introduced with a distinguishing MODIFIER, and to
                        what. Pure and deliberately narrow; the list of cases it
                        refuses is the design (see Cumulative References below)
    signFix.ts          suggestSign — which sign a term is USUALLY written with, so
                        the editor's context menu can offer to correct a mistyped
                        one. Frequency decides; an even split proposes nothing
    extract.ts          detectOrdStems, extractData, classify; the ExtractResult
                        interfaces live at the top. extractData orchestrates
                        named phase functions (findSignGroups, computeArticleErrors,
                        findBareTerms, computeNumberingErrors) rather than inlining
                        them. The scans collect occurrences and buildFromOccurrences
                        turns them into the structures in a SECOND pass — the
                        cumulative rule needs the whole document, since the numbered
                        form may be written after the shortened one
    claims.ts           segmentClaims / parseClaimRefs / computeClaimGraph — claim
                        spans, dependency refs (single, lists, ranges, "preceding
                        claims", EN+DE), transitive ancestors, depErrors
    scrollSync.ts       backdropScroll — splits the textarea's scroll offset into
                        the part the backdrop can scroll to and the elastic-
                        overscroll remainder it can only be translated by
    buildHtml.ts        esc, buildHtml, findAtPos (buildHtml appends a trailing
                        newline sentinel so the backdrop and textarea share a
                        scrollHeight — see the trailing-newline note below)
    crossref.ts         computeCrossRef (Description ↔ Claims comparison)
    reflist.ts          buildRefList / toPlainText (reference numeral list)
    beeFlight.ts        spawnBee / stepBee / beeGone — the easter-egg bee's
                        motion model, pure so it is unit-testable. Reached ONLY
                        through the lazy Bee chunk; nothing eager may import it
    beeCount.ts         countBees, alone, because useBee runs it on every settled
                        keystroke — one eager import of it out of beeFlight.ts
                        dragged the whole motion model onto the critical path
    *.test.ts           Vitest unit tests for the above
  hooks/
    useDebounced.ts     Debounce hook (defers extraction on large docs; a delay of
                        0 passes the value through with zero extra renders)
    useEditorSync.ts    The imperative half of the editor: scroll mirroring, the
                        per-sign mark index behind hover highlighting, scroll-to-span
                        and the caret restore. The only place that touches the DOM.
                        The re-mirroring effect is gated on "has the editor ever
                        scrolled" — reading the geometry to find out costs the
                        app's whole first layout, forced inside the mount task
    useDocumentIO.ts    The whole .docx round trip — import, export, undo, file
                        picking, the banner report. It does NOT own the buffers: it
                        reads them through `buffers` and writes through `apply`, so
                        App keeps deciding what loading a document means elsewhere
    usePersistentState.ts  useState + localStorage (codecs: jsonCodec/setCodec/oneOf).
                        Optional {debounce, onError}: the text buffers debounce their
                        writes and flush on pagehide/visibilitychange
    useTheme.ts         Theme preference + <html data-theme> application
    useFileDrop.ts      Window-level file drag/drop (preventDefault on dragover +
                        drop, or the browser opens the file instead of the app)
    useBee.ts           Decides when a bee appears (rare random draw + typing "bee")
    useHotkeys.ts       Window-level shortcuts. Unmodified keys are suppressed while
                        the user is typing — the editor holds focus nearly always, so
                        a bare "/" binding would make the app impossible to type in
  test/
    setup.ts            Vitest setup (jest-dom + matchMedia/clipboard stubs)
    helpers.ts          must() / q() — turn "this might be missing" into a named
                        test failure rather than a non-null assertion or a `?.`
                        that lets a broken fixture pass
    globals.d.ts        Ambient declarations for the test environment
  components/           React components
    App.tsx             Application state and wiring, editor pane
    TopBar.tsx          Logo, file actions, theme/mode/language toggles, help button
    StatusBar.tsx       Error-count chips, prev/next stepper, restore-all
    icons.tsx           The inline SVGs, out of the components that use them
    Sidebar.tsx         Overview pane (stats, search, card sections) — presentational
    RefPane.tsx         Left pane: the derived numeral list + the drafter's own list
    Section.tsx         The collapsible ▾/▸ section header, shared by both panes
    HelpDialog.tsx      Usage guide + keybindings (the app's only focus trap).
                        Lazily imported, and reads helpText.ts itself rather than
                        taking `t` — passing the strings in would have kept them
                        on the critical path, which is the point of the split
    LazyHelpDialog.tsx  The dynamic import in front of it, plus preloadHelpDialog
                        (the ? button starts the fetch on hover/focus)
    SignCard.tsx        A reference sign with its associated terms
    ErrorCard.tsx       ONE card for all four non-sign categories, driven by its
                        ERROR_KINDS row. Replaced ArtCard/BareCard/NumCard/DepCard,
                        which were the same component four times over
    RefList.tsx         Collapsible reference numeral list + copy
    CtxMenu.tsx         Right-click context menu
    DropOverlay.tsx     Drag-over affordance (pointer-events:none — the editor
                        hit-tests with elementFromPoint)
    ImportBanner.tsx    Import result + warnings + one-step Undo
    RefListCheck.tsx    Reference-list paste box + reconciliation findings
    ClaimStats.tsx      Claim-set statistics panel (claims mode)
    OrphanCard.tsx      The sign/message row shared by the cross-reference section
                        and the reference-list check — it was nine copies across
                        Sidebar and RefListCheck
    DismissButton.tsx   The ×/↩ button on every card. Its stopPropagation is the
                        load-bearing part: the button sits inside a card that is
                        itself activatable
    StatCell.tsx        One figure-over-label cell of a .stats-row, shared by the
                        sidebar's three and the claim-set panel's four
    cardProps.ts        activatable() — role/tabIndex/key handling shared by the cards
    Bee.tsx             The easter-egg bee (rAF loop writing transforms directly)
    App.smoke.test.tsx  Server-render smoke test (node env)
    App.ui.test.tsx     Interactive DOM tests (jsdom env)
```

### Core Functions

| Function                                  | Module                         | Purpose                                                                                                                     |
| ----------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `tokenize()`                              | `logic/tokenize.ts`            | Splits text into word/number tokens                                                                                         |
| `extractData()`                           | `logic/extract.ts`             | Extracts signs, terms, article usage, bare terms, numbering + dependency errors                                             |
| `classify()`                              | `logic/extract.ts`             | Determines if a sign has errors                                                                                             |
| `canonicalCumulativeTerms()`              | `logic/cumulative.ts`          | Which shortened terms are back-references to a modified term of the SAME sign, and to what                                  |
| `isOrd()`                                 | `logic/constants.ts`           | Is this word a distinguishing **modifier** (`first`/`erste`, `upper`/`obere`) — the one vocabulary, tabulated below         |
| `suggestSign()`                           | `logic/signFix.ts`             | The sign a term is usually written with, when this occurrence uses a rarer one — the context menu's correction offer        |
| `ERROR_KINDS`                             | `logic/errorKinds.ts`          | The table of error categories — the single place that knows one exists (see Error Categories)                               |
| `eachErrorSpan()`                         | `logic/errorSpans.ts`          | The single walk over all error categories; `buildHtml` and `getAllErrors` both consume it                                   |
| `ctxMenuItems()`                          | `logic/ctxMenuItems.ts`        | What the editor's right-click menu offers for whatever `findAtPos` reports at the caret                                     |
| `getAllErrors()`                          | `logic/errorSpans.ts`          | Collects all error positions for navigation — signature `(result, mode, dis)`; each entry names its `term`                  |
| `errorGroup()`                            | `logic/errorSpans.ts`          | The "same term" bucket for Ctrl+Shift+↓/↑ — the term stem, or the category for errors that have no term                     |
| `computeClaimGraph()`                     | `logic/claims.ts`              | Claim spans, dependency refs, transitive ancestor sets, `depErrors`, and `direct` (per-claim parents, used by `claimStats`) |
| `buildHtml()`                             | `logic/buildHtml.ts`           | Generates highlighted HTML for the backdrop — signature `(text, result, mode, dis, focusSign)`                              |
| `findAtPos()`                             | `logic/buildHtml.ts`           | Finds the sign / article / bare term at a given character position (what the editor's context menu acts on)                 |
| `backdropScroll()`                        | `logic/scrollSync.ts`          | Splits a scroll offset into `{top, shift}` so overscroll cannot desync the highlights                                       |
| `computeCrossRef()`                       | `logic/crossref.ts`            | Compares two **already-computed** extraction results (Description vs Claims)                                                |
| `isClaimNumber()`                         | `logic/constants.ts`           | Detects a line-leading Arabic claim number (`1.`, `1)`)                                                                     |
| `isSignToken()`                           | `logic/constants.ts`           | Single source of truth for what counts as a sign (Arabic **or** Roman-numeral step)                                         |
| `compareSigns()`                          | `logic/constants.ts`           | Sign sort: all Arabic first (value, then suffix — `10'`, `10a`), all Roman steps grouped at the end (`I`/`I.1`/`II`)        |
| `romanToInt()` / `signVal()`              | `logic/constants.ts`           | Roman→integer conversion; numeric ordering value for any sign                                                               |
| `buildRefList()`                          | `logic/reflist.ts`             | Builds the sorted sign → term numeral list                                                                                  |
| `parseRefList()`                          | `logic/refListParse.ts`        | Parses a drafter's reference list (`10 housing`, `12 – Gehäuse`, tabs, dashes)                                              |
| `listTermIndex()`                         | `logic/listTerms.ts`           | Indexes the list's multi-word terms; `sig` lets a caller tell "same content" from "same object"                             |
| `listExtra()`                             | `logic/listTerms.ts`           | How many words the list says a term takes beyond its base noun (0 = it says nothing)                                        |
| `appliedListTerms()`                      | `logic/listTerms.ts`           | Which listed multi-word terms the text actually uses as such — what the panel reports                                       |
| `reconcileRefList()`                      | `logic/reconcile.ts`           | Diffs that list against the signs actually used; stem-compared, so plurals do not false-alarm                               |
| `claimStats()`                            | `logic/claimStats.ts`          | Claim-set counts, multiple dependency, DPMA/EPO claim-count thresholds                                                      |
| `stemEn()` / `stemDe()`                   | `logic/stem.ts`                | Language-specific word stemming                                                                                             |
| `matchHeading()`                          | `logic/headings.ts`            | Classifies a line as a section heading → `{kind, lang}` (whole-line match, then short-line prefix)                          |
| `splitPatentDoc()`                        | `logic/docSplit.ts`            | Document model → Description/Claims buffers + `detected` report                                                             |
| `detectLang()`                            | `logic/detectLang.ts`          | Heading-derived language, falling back to stopword scoring                                                                  |
| `readDocx()` / `docxXmlToParagraphs()`    | `logic/docx/read.ts`           | `.docx` → paragraph model (the only OOXML-aware code)                                                                       |
| `writeDocx()` / `planEdits()`             | `logic/docx/write.ts`          | Writes edits back into the original file, rewriting only changed paragraphs                                                 |
| `orderSplices()`                          | `logic/docx/write.ts`          | Orders the splices for back-to-front application and **throws** rather than applying an overlapping set                     |
| `alignLines()`                            | `logic/docx/lineDiff.ts`       | Which imported line became which edited line (LCS + positional pairing)                                                     |
| `conformClaim()`                          | `logic/docx/claimNumbering.ts` | Makes an exported claim line match how the section numbers its claims                                                       |
| `xmlText()`                               | `logic/docx/xmlText.ts`        | The only producer of `<w:t>` content: drops characters XML 1.0 forbids, then escapes                                        |
| `verifyExport()`                          | `logic/docx/verify.ts`         | Re-reads the produced file and compares it with the buffers                                                                 |
| `importPatentDoc()` / `exportPatentDoc()` | `logic/importDoc.ts`           | The seam App.tsx calls; hides read/split/detect, round-trip-vs-fresh, and verification                                      |
| `spawnBee()` / `stepBee()` / `beeGone()`  | `logic/beeFlight.ts`           | Easter-egg bee flight: spawn off a random edge, dart around, leave (lazy chunk only)                                        |
| `countBees()`                             | `logic/beeCount.ts`            | The typed trigger, kept apart from the flight model because it runs eagerly on every settled keystroke                      |

## Features

### Modes

- **Description Mode**: Validates sign-term consistency throughout the text; each mode maintains its own text buffer
- **Claims Mode**: Additionally checks that signs are wrapped in parentheses `(10)` — a grouped list such as `(6, 12; 13)` counts as parenthesised for every sign inside it — validates claim numbering and dependencies, and switches article checking to per-claim antecedent basis
- Mode buttons show a dot indicator when their buffer contains text

### Claim dependencies (claims mode)

- `logic/claims.ts` segments the buffer into claims (via the line-leading claim numbers) and parses references: `according to claim 3`, `of claim 1 or 2`, `any one of claims 1 to 4`, `nach Anspruch 3`, `nach einem der Ansprüche 1 bis 4`, and `preceding claims` / `vorhergehenden Ansprüche` phrases. EN and DE patterns are always both parsed
- **depErrors** flags references to **nonexistent** claims, **forward** references (to a later claim), and **self**-references; each carries an edit-stable dismissal key (`claim>ref#ordinal`)
- Ranges (`claims 1 to 4`) expand into intermediates for the dependency graph, but only the literally written numbers are validated/highlighted
- Bad references never create graph edges, so the ancestor computation is acyclic by construction

### Cross-reference

- When both Description and Claims buffers have content, a **Cross-reference** section appears in the sidebar listing signs present in one buffer but absent from the other
- Also reports **sign/term conflicts** across buffers and a `notIntroducedInDesc` category — claims signs that _do_ appear in the description but only ever **bare** (without a term), i.e. never properly introduced. This is mutually exclusive with `missingInDesc` (absent entirely)

### Word (.docx) import and export

- **Drag a `.docx` anywhere onto the window**, or use the **Import .docx** button. The
  drag handlers live on `window` (`hooks/useFileDrop.ts`) and `preventDefault` on both
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
- The dictionary in `logic/headings.ts` is **data**: adding French means adding an `fr`
  key to each entry, with no control-flow change. Exact whole-line matches cannot
  collide, so `Brief description of the drawings` (figure listing) and `Description of
the drawings` (detailed description) coexist; the ordered prefix fallback for the
  long tail is longest-first for the same reason, and only applies to short lines
- **Language is derived from the matched headings** — a `Patentansprüche` heading _is_
  the DE signal. The claims heading wins if the two disagree; stopword scoring
  (`detectLang.ts`) only runs when no heading matched at all
- **Word auto-numbered claims are reconstructed.** Numbers created by Word's list
  numbering live in `numbering.xml`, not in the text, so such claims import as
  `A device comprising…` with no `1.` — and since `isClaimNumber` needs a literal
  line-leading digit, claim segmentation, numbering, dependencies _and_ antecedent
  basis would all silently go dead. `docSplit.ts` synthesizes `N. ` for
  `<w:numPr>` paragraphs (single-level decimal; deeper levels are flagged, not
  guessed) and records the prefix on the provenance handle so export strips it again
- Headers, footers, comments and footnotes are separate ZIP parts and are excluded for
  free; **text boxes** (`<w:txbxContent>`) are inline in `document.xml` and are skipped
  explicitly. Tracked insertions are kept and deletions dropped (an "all changes
  accepted" view). Legacy binary `.doc` is detected and rejected with a clear message
- **The reader and the writer are mirrors and must stay that way.** `<w:br/>`,
  `<w:tab/>`, `<w:noBreakHyphen/>` and `<w:softHyphen/>` are read as `\n`, `\t`,
  U+2011 and U+00AD, and written back as the same elements. Dropping the two hyphens
  (as the reader once did) glues a hyphenated term together in the buffer
  (`cross‑section` → `crosssection`) and then deletes the hyphen from the file the
  moment that paragraph is edited. Add a fifth element to one side and the other side
  needs it too
- **Export writes back into the original file.** Only paragraphs the user actually
  changed are rewritten (line-level diff in `docx/write.ts`); every other paragraph and
  every other ZIP part stays byte-identical, so the abstract and figure listing survive
  untouched. A rewritten paragraph collapses to a single run carrying the first
  original run's `<w:rPr>`, so intra-paragraph formatting is lost **in edited
  paragraphs only** — the export button's tooltip says so. With no imported source
  (hand-pasted text) the button generates a fresh minimal `.docx` instead
- **Every exported claim lands at the same alignment as its neighbours**, because Word
  takes both the indent and the list number from the _paragraph_. Four things in
  `docx/write.ts` protect that, and each was a real defect: (1) a line the diff sees as
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
  claim line lands in is an artefact of the diff, so `conformClaim` (`docx/write.ts`)
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
- **The reference list is written back too, but only when the source is unambiguous.**
  `refListWritable` (`docSplit.ts`) refuses three shapes, each of which would damage the
  file rather than update it: `noSection` (nothing to write into), `ambiguous` (the
  list's paragraphs are also in the description buffer — with no detailed-description
  heading the splitter falls back to "everything before the claims", which swallows a
  list placed there), and `table` (a two-column table puts every cell in its own `<w:p>`,
  so the section reads "10 / device / 12 / housing" down the lines and diffing edited
  text against it moves values between cells). The other buffers export regardless and
  the banner names the reason — an edit that was not saved must not look like one that was
- The list adds a **third** buffer to the same `document.xml`, which is why
  `refListWritable` matters: the guarantee that the ranges are disjoint is what makes
  writing three of them as safe as writing two. `orderSplices` (below) is the backstop
  underneath it, and the export verification covers the result either way
- `read.ts` tracks `<w:tbl>` depth and flags paragraphs with `inTable`, which is what
  makes the table case detectable at all
- `imported` (the source bytes + paragraph provenance) is deliberately **not**
  persisted to `localStorage` — a 200 KB document would blow the quota alongside the
  text buffers — so a refresh keeps the text but drops round-trip export

#### Three guards on "exactly those changes and no others"

The export promise is narrow and total, and it is worth understanding why it takes
three separate mechanisms rather than one.

1. **The buffers are disjoint by construction** (`docSplit.ts`). Each section is
   clipped at every other _located_ section's heading, not just at the heading kinds
   that normally follow it. Without that, a draft whose claims heading precedes the
   description heading — an amendment sheet — gave both buffers the same paragraphs,
   and export wrote two different texts over one range: the description vanished from
   the file with no warning. Clipping only at located sections is deliberate; clipping
   at every heading of a section _kind_ would truncate a German description at its own
   `Ausführungsbeispiel 2` subheading.
2. **`orderSplices` refuses a splice set it cannot apply safely** (`docx/write.ts`).
   Splices are applied back-to-front, and at the _same_ offset an insertion and a
   replacement can meet: a line inserted after paragraph P lands at P's `xmlEnd`, which
   is exactly paragraph P+1's `xmlStart`, and P+1 may have been edited too. Applying
   the insertion first left the replacement's range pointing at the text just inserted,
   so it ate the new paragraph and cut the next one in half — the output was not
   well-formed XML and Word refused to open it. The replacement now goes first; anything
   still overlapping after that throws (`DocxError('spliceOverlap')`) rather than
   shipping a mangled application. The comparator is a _subtraction_, not `? -1 : 1`,
   because the latter is not a total order and `sort` may then do anything with it.
3. **The written file is read back and compared** (`docx/verify.ts`). The other two
   guards each answer a failure somebody already found; this one does not need to know
   the failure mode. `exportPatentDoc` re-runs the whole import pipeline over the bytes
   and diffs them against the buffers, returning `verified` + `diffs`. It tolerates
   exactly two deliberate differences — trimmed blank edges, and claim numbers when the
   claims are a Word list (Word owns those numbers, and the ones it renders need not
   match what the user typed; that mismatch is the tool's own claim-numbering check, not
   an export fault). The file is still delivered when verification fails, with a banner
   naming the first differing line: refusing to export would leave a drafter with no way
   to get their work out.

A fourth, smaller one: `docx/xmlText.ts` is the **only** producer of `<w:t>` content.
Escaping `& < >` is not enough — a patent draft is often pasted out of a PDF, which
brings form feeds, other C0 controls and unpaired surrogates. Those cannot appear in an
XML 1.0 document at all, so writing one produced a file Word rejected outright. They are
dropped. Carriage returns go too: a parser normalizes a literal CR to a line break, so
one would come back as a break Word inserted by itself.

Note that **re-importing an exported file does not prove it is well-formed** — the
reader is a tag scanner and reads bad nesting happily, while Word does not. The tests
use `xmlFault` (`docx/fixture.ts`) for that.

### Easter egg: the bee

- A bee occasionally flies across the window. Two triggers: a rare random draw
  (`useBee.ts` runs a Bernoulli trial every 10s with p = tick/mean, so the wait is
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
- `logic/beeFlight.ts` is the pure motion model (unit-tested): the bee spawns just
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
- `logic/refListParse.ts` is deliberately liberal about the separator (`10 housing`,
  `12 - cover`, `14\tshaft`, `16: seal`, `18) flange`) and strict about exactly one
  thing: the line must START with a reference sign, so headings and prose inside the list
  are skipped rather than guessed at
- `splitPatentDoc` already located the Bezugszeichenliste and discarded it; it now returns
  it as `signList`, which is what makes the import auto-fill work. It is still excluded
  from the description and claims buffers
- Persisted under `rsc_reflist`; cleared by **Reset all** and restored by the import
  **Undo**, alongside the text buffers
- The list is also **read into the extraction**, not only compared against it: its
  multi-word terms are applied to both buffers (see Multi-word Terms). The panel says so
  with an `ⓘ` note naming the terms it contributed — that is silent work on the drafter's
  text, and a change nobody can see is a change nobody can undo. The note is information,
  not a finding, so it borrows the claim-set panel's `ⓘ`/`--info` and stays out of the
  section's count
- Editing the list box re-runs extraction, so on a large document (>5000 chars across
  both buffers) the index input is debounced the same way the buffers are, and the index
  carries a content signature (`sig`) that App uses to hold its identity — most edits in
  that box (a typo mid-term, a re-ordered line, a single-word entry) change nothing the
  extraction can see, and a fresh object would still invalidate both memoized results

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
- `THRESHOLDS` in `logic/claimStats.ts` holds these as **counts, not currency** — the
  amounts are revised regularly, the structure of the rules is not. There are deliberately
  no USPTO thresholds; a test asserts none are ever emitted
- A range (`any one of claims 1 to 4`) is _one_ multiply-dependent claim, not four
- **Nothing in this panel is a validation error.** A multiply-dependent claim is a
  legitimate drafting choice with a fee attached, not a mistake, so the notes render as
  information (`ⓘ`, `--info`, muted text) rather than borrowing the warning triangle the
  real error cards use — which would imply something needs fixing

### Keyboard

- Bindings are chosen for a **German layout**: `[`/`]` need AltGr there and `/` needs
  Shift, so the old `Ctrl`+`[`/`]` and bare `/` were awkward on the very keyboards this
  tool is for. `Ctrl`/`Cmd`+`↓`/`↑` step through the errors, `Ctrl`+`F` focuses the sign
  filter, `Ctrl`+`?` opens help. **Up/Down, not Left/Right** — `Ctrl`+`←`/`→` is
  word-by-word cursor movement inside a textarea, which a drafter uses constantly
- `Ctrl`+`Shift`+`↓`/`↑` is the same step **restricted to one term**: the next faulty
  "banana", skipping the "kiwi" errors in between. The buckets come from `errorGroup`
  (`logic/errorSpans.ts`) — the term **stem**, so an inconsistent sign, the article in
  front of it and a bare occurrence of the same noun are one group, and a sign is grouped
  by the term of _that_ occurrence rather than by all the terms it was ever written with.
  Claim numbering and dependency errors name no term and step within their own category
  instead of sharing one nameless bucket. A term with a single error stays put: jumping to
  an unrelated one is exactly what the binding exists to avoid. The jump measures from the
  arrows' cursor, unless a sidebar card has since focused a different error (`anchorIdx`)
- `Ctrl`+`M` switches mode, `Ctrl`+`B` / `Ctrl`+`Shift`+`B` fold the side panes,
  `Ctrl`+`O` imports, `Ctrl`+`S` exports, `Escape` closes the help screen or the context
  menu. The old `Ctrl`+`[`/`]` and `/` still work, undocumented, for muscle memory
- `?` arrives as `Shift`+`ß` on a German layout and `Shift`+`/` on a US one; both report
  `e.key === '?'`, so one binding covers both
- **Every new binding takes a modifier** because `useHotkeys` suppresses unmodified keys
  while the user is typing and the editor holds focus nearly always — a shortcut that
  dies mid-sentence is worse than none
- A **help screen** (circled `?` in the top bar, or `Ctrl`+`?`) carries a seven-line usage
  guide and the full key list. It is the app's **only focus trap**: the editor is still
  behind it, so focus escaping would send typing somewhere invisible. `HelpDialog.tsx`
  restores focus to the button that opened it, the way `CtxMenu` does
- Bindings **without** a modifier are suppressed while the user is typing (`useHotkeys.ts`)
  — the editor is a `<textarea>` that holds focus almost all the time, so an unqualified
  `/` binding would make the app impossible to type in
- Every error card is keyboard-reachable: they carry `role="button"`, `tabIndex={0}` and
  Enter/Space handling via `activatable()` in `components/cardProps.ts`. They cannot simply
  BE `<button>`s — each already contains a nested dismiss button, and nesting interactive
  elements is invalid HTML

### Reference numeral list

- A collapsible **Reference list** section in the sidebar shows the active buffer's signs in a numerically sorted `sign → term → count` table (dominant term per sign)
- **Copy** button puts a tab-separated `sign<TAB>term` list on the clipboard for pasting into a draft
- The dominant term is the most frequent one, tie-broken by width and then by first
  appearance — but a term referred back to without its modifier never reaches that
  tie-break at all, because it is not a term of its own (see Cumulative References). A list
  reading `10 Wellen` for what the draft introduced as the first shaft is wrong however
  often the plural was written, so frequency must not be allowed to decide it

### Languages

- **English (EN)**: English article rules (a/an vs the)
- **German (DE)**: German article rules with gender consistency checking (der/die/das)

### Fonts

- **There are no web fonts.** Both faces are system stacks defined once in `styles.css` as
  `--font-ui` and `--font-mono`. Six self-hosted `.woff2` files (Space Grotesk ×4, JetBrains
  Mono ×2) were **95.8 KB — 54% of the critical path**, more than the framework and the whole
  application put together, and the app now fetches no font at all
- **The two stacks are not interchangeable, and that is the thing to get right.** `--font-mono`
  backs the editor, where the textarea and the highlight backdrop are two separately laid-out
  layers that must agree character for character; a proportional face there slides the
  highlights off the text under them. `--font-ui` backs everything else and is deliberately
  proportional. Applying the mono stack to something that was proportional turns the UI into
  code, which is why the replacement was done per-variable rather than globally
- The alignment invariant is "**same font on both layers**", not "same font on every machine" —
  both layers read `var(--font-mono)`, so they stay locked to each other wherever they render.
  Verified in Chromium: identical computed `font`, `line-height` and `scrollHeight` across the
  two layers
- Each stack is ordered most-native-first and ends in the generic keyword, so every platform
  lands on the face it draws UI (or code) with rather than on a browser default. Weights are
  synthesized from the one system family, which is why the four Space Grotesk weight files were
  not replaced by anything

### Theme

- **Light / Dark / System**: Theme preference stored in `localStorage` (`rsc_theme`)

### Layout

- Three columns on desktop: **reference list** (left), **editor** (middle), **reference
  signs** (right). Only the editor is fluid — the side panes hold lists at a readable
  width, and giving them a share of the width squeezes the editor at every size
- **Both side panes collapse** to a 34px rail that keeps its chevron, so the way back is
  always visible. The choice persists (`rsc_panes`)
- Collapsing is **CSS, not unmounting**. One mechanism has to own it, or the mobile tab
  bar and the desktop chevron disagree about what exists; `display: none` also takes the
  search box out of the tab order, which unmounting would have done for free
- **Narrow screens show one pane at a time**, chosen by a tab bar (≤860px). Stacking all
  three would bury the reference list under a screen of error cards and keep the editor
  at the cramped height the old two-pane layout gave it. A middle breakpoint
  (861–1100px) narrows the side panes before anything is taken away
- The left pane renders **even with an empty document** — a drafter working from an
  existing list wants to paste it in before typing a word. While it lived in the
  sidebar's `totalSigns > 0` branch there was nowhere to put it
- Two side panes means **two `complementary` landmarks**, so both are named; an unnamed
  pair is indistinguishable to a screen reader jumping between them

### Error Categories (`logic/errorKinds.ts`)

The four non-sign error categories — **article**, **missing sign**, **claim numbering**,
**claim dependency** — are rows in one table rather than parallel code in nine files.
Each row names where `extractData` puts the records, how to identify one for dismissal,
its span, its term (or `null`), its highlight class, its search predicate, and the
presentation data (glyph, colour token, i18n keys, message formatter).

**Adding a category** is: produce it in `extract.ts`, add a row, add its i18n keys, and
define `--<color>` / `--<color>-bg` in both themes. `errorSpans.ts`, `buildHtml.ts`,
`App.tsx`, `Sidebar.tsx`, `ErrorCard.tsx` and the status bar all pick it up by looping the
table. That used to be a nine-file edit; it is a three-file one now.

The rows carry UI data as well as logic on purpose. They are plain strings and pure
functions, so the module stays framework-free and still runs under the node test env —
and splitting them into a second table under `components/` would recreate exactly the
two-places-to-edit problem the table removes. `message(item, t)` takes the resolved
strings as an argument, so nothing here imports i18n or React.

Three things must not be "simplified", each guarded by `errorKinds.test.ts`:

1. **The dismissal prefixes are a storage format.** `s:` `a:` `b:` `n:` `d:` live in
   users' `localStorage` under `rsc_dis`. They stay literal in `disKey`
   (`constants.ts`) and are referenced by name. They happen to be first letters, so
   deriving them from `id` would work today and silently discard every stored dismissal
   the first time a category is added whose initial collides.
2. **`focus.key` is not uniform.** It is the sign string for `sign` and a character
   offset for every other kind. `focusCycle`, `anchorIdx` and each card's `focused`
   comparison depend on that asymmetry.
3. **`navProp`** is the property `getAllErrors` carries the raw record under
   (`ae`/`bt`/`ne`/`de`); `App.tsx` and the tests read those by name.

**Signs are deliberately not a row.** They carry a severity, several occurrences, a
term-conflict story and their own card, so every consumer special-cases them anyway; a row
would be mostly unused fields plus consumers that still branch. The same reasoning keeps
`ctxMenuItems.ts` per-category: a sign offers extend/reduce plus dismissal, a bare term
additionally offers writing the missing sign in, an article offers only dismissal — there
is no uniform behaviour there for a table to drive.

### Error Management

- Every card section in the sidebar (Inconsistencies, Article Errors, Missing Signs, Claim numbering, Claim Dependencies, Consistent, Dismissed, Cross-reference) is **collapsible**, styled like the Reference list's own header (▾/▸ arrow, icon, label, count). Click the header to toggle; a section hides itself entirely when its count is 0 rather than being unmounted by the caller, so a toggle survives the count dropping to 0 and back. `Section` (a local helper in `Sidebar.tsx`) owns the open/closed state, defaulting to open
- Click an error card in the sidebar to jump to its occurrence in the text; clicking the **same card again cycles to the next occurrence** (document order), and the click after the last one clears the focus. A single-occurrence card (article/bare/numbering/dependency) therefore just toggles, while a multi-occurrence sign steps through all its marks. `focusCycle` in `App.tsx` owns this, keyed by an occurrence cursor (`focusOcc` ref)
- Hover a sign number in the editor to highlight its sidebar card; hover a card to highlight its marks in the editor
- Use arrow buttons in status bar to cycle through errors
- Dismiss individual errors or all errors
- Right-click context menu for advanced options. It acts on whatever sits at the caret —
  a **sign**, an **article**, or a **term written without its sign**. That last one was
  missing: the bare occurrence the tool highlights was the one thing in the editor that
  could not be acted on, so "extend the term" had to be reached from some _other_
  occurrence of the same word. `findAtPos` now reports bare terms too, and the menu
  offers the same Extend / Reduce term (they are properties of the term, not of the sign
  beside it) plus its own dismissal
- The sign menu can **correct a mistyped reference sign** (`logic/signFix.ts`). A typo
  reads exactly like a term-to-sign inconsistency, and the tool used to report it without
  saying which of the two occurrences was the slip — so the drafter worked it out and
  retyped it. Frequency answers that: in `Begriff 1 / Begriff 2 / Begriff 1`, the term is
  written with 1 twice and 2 once, so right-clicking the odd one offers _Correct reference
  sign 2 → 1 (2× elsewhere)_. The count is in the label because this rewrites the
  drafter's text, and the evidence for doing so belongs where the click is. Only the
  sign's own characters are replaced, so a claims-mode `(2)` keeps its brackets.
  **Refused where the evidence is not one-sided**: an even split (`Begriff 1 / Begriff 2`)
  is a genuine ambiguity rather than a majority, and a tie between two alternatives is
  refused for the same reason the bare-term menu withholds "insert sign" when a term has
  two signs. The offer appears on the term as well as on the sign, since that is where a
  drafter reading the sentence actually right-clicks
- The bare-term menu can also **write the missing sign in** — ` 10` in description mode,
  ` (10)` in claims mode, since a bare sign there is an error of its own. Offered only
  when the term is known under **exactly one** sign; with two or more, picking between
  them is the drafter's call. `insertSign` re-checks that the term is still at the
  recorded span before splicing (the spans come from the debounced extraction, so the
  buffer may have moved on) and leaves the caret after what it wrote
- **Reset all** button (bottom-right, fixed) clears multi-word overrides, dismissed errors **and both text buffers** (behind a confirm dialog, since it now discards typed text)

### Persistence

- Both text buffers autosave to `localStorage` (`rsc_desc`, `rsc_claims`) and are restored on load, so work survives a refresh
- **Language, mode and dismissed errors** persist too (`rsc_lang`, `rsc_mode`, `rsc_dis`) — restoring German text without also restoring the DE language setting used to produce a wall of false article errors
- All persistence goes through the `usePersistentState` hook (one place for the localStorage try/catch and codecs)
- Extraction is **debounced** for large documents (≥5000 chars) via `useDebounced`; the textarea stays immediate and the highlight backdrop is built from the same debounced buffer so spans never misalign
- The textarea and the highlight backdrop are two scroll-synced layers (`syncScroll` mirrors `scrollTop` on the textarea's `onScroll`). Because the backdrop content is debounced, a large **paste** scrolls the textarea to the caret before the taller backdrop has rendered, so the one scroll event syncs against stale, short content and the highlights sit shifted until the next manual scroll. An `useIsoLayoutEffect(() => syncScroll(), [html])` in `App.tsx` re-mirrors the scroll position after the backdrop content commits, realigning the layers before paint. `buildHtml` also appends a trailing-newline sentinel so a buffer ending in `\n` keeps both layers the same height (see Sign Detection / `buildHtml.ts`)
- **Elastic overscroll used to break that mirroring at both ends of the document.** Scrolling past the top or bottom on macOS/iOS rubber-bands the textarea's content beyond its own scroll range; the backdrop clamps any offset outside `[0, scrollHeight - clientHeight]`, so the text bounced while the highlights stayed pinned to the edge of the box. `overscroll-behavior: none` on `.backdrop, .editor-ta` suppresses the rubber-band itself (it is also what stops the gesture chaining out to the page), and `syncScroll` routes through `backdropScroll` (`logic/scrollSync.ts`), which splits the reported offset into the part the backdrop can scroll to and an overshoot applied as a `translateY` — the engines that _do_ surface the overscroll in `scrollTop` (iOS Safari) are then handled too. The rubber-band is a compositor effect that never reaches `scrollTop` in most engines, so the CSS line is load-bearing rather than decoration, and a unit test asserts it is still there

### Offline Support

The app runs entirely client-side (no backend calls), so once loaded it needs the network
only for the initial fetch. Three things are required for that to actually hold, and all
three are now in place:

- **The app shell is precached at install time.** `build/swPrecache.ts` is a Vite plugin
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

Supporting pieces: there are **no web fonts at all** (see Fonts), so no font request can
remain to fail; the stylesheet is **inlined into `index.html`**, so styling cannot miss the
cache separately from the document; the bee sprite is vendored rather than fetched from a
CDN; and `public/manifest.webmanifest` + `public/icon.svg` make the page installable.

The install handler is `cache.addAll` with one addition: a **content-hashed URL an older
cache already holds is copied across rather than refetched**, since the same URL cannot mean
different bytes. Only hashed URLs — the navigation, the manifest and the icon are always
refetched, or a deploy would pin the old one forever. It keeps `addAll`'s all-or-nothing
behaviour: a non-2xx rejects the whole install, because a half-filled cache that reports
success is exactly the failure precaching exists to prevent (`build/swInstall.test.ts` runs
the shipped worker against a fake CacheStorage to hold all of this).

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

A term is the base noun in front of a sign unless something widens it. Three things can,
and the order between them is the whole design:

- **The drafter's own reference list** (`logic/listTerms.ts`). An entry reading
  `30 control unit` already states that the term is two words, so the text scan takes it
  from there instead of leaving the drafter to extend it by hand — which also makes the
  reference-list check stop reporting every listed multi-word term as a term mismatch
  ("list: control unit · text: unit"). It applies to **both** buffers, because the list
  describes the application, not one section of it; it is filled by a `.docx` import and
  by pasting alike, since both write the same `refListText`
- **The ordinal pattern** ("first bearing" / "second bearing"), detected from the text
  against the fixed word list below
- **A manual override** via the context menu's "Extend term" / "Reduce term", stored in
  `localStorage` (`rsc_mwo`)

The two automatic sources take the **wider** of the two. A manual override **wins
outright over both, including an explicit 0** — that is what makes "Reduce term" work at
all here: it used to `delete` the key at width 1, which under an automatic source just
handed the term straight back and the reduction appeared not to happen. Both menu actions
therefore write an **absolute** width measured from the term as displayed, not `mwo + 1`.

- **The match is on the whole phrase, not the base noun.** A list holding `control unit`
  does not widen "the drive unit 40" — the words actually written in front of the sign
  must stem-match the listed phrase. That is what lets one list hold both `unit` and
  `control unit`, and it is the difference between reading the list and guessing from it.
  The longest listed phrase wins, so `first bearing surface` beats `bearing surface`
- The index is keyed on the **last two words**, not just the base noun. A real list names
  three hundred different "… element"s, and keying on the noun alone would make every
  occurrence compare against a third of the list; `perf.test.ts` covers exactly that shape
- Stems compare, so "control units" in the list matches "control unit" in the text
- Words consumed by a multi-word term are not flagged as bare-term errors; a bare
  occurrence of a widened term is reported as the full phrase
- The term-width badge (`2w`) on a sign card comes from the recorded term stem, per chip
  — reading it back out of `mwo` only ever knew about manual overrides

#### The modifier vocabulary (`EN_ORD` / `DE_ORD` in `constants.ts`)

"The ordinal pattern" is not only ordinals. `isOrd` matches a fixed list — matched on the
**raw lowercased word**, not the stem — and any of them directly in front of the base noun
widens the term to two words (`detectOrdStems` learns the base noun from one such
occurrence, and every later occurrence of that noun preceded by one of these words is
widened).

|        | **Numberings**                                                                                            | **Qualifiers**                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EN** | `first` `second` `third` `fourth` `fifth` `sixth` `seventh` `eighth` `ninth` `tenth` `eleventh` `twelfth` | `further` `other` `another` `next` `upper` `lower` `inner` `outer` `front` `rear` `left` `right` `top` `bottom` `primary` `secondary` `main` `auxiliary` `additional` |
| **DE** | `erst` `zweit` `dritt` `viert` `fünft` `sechst` `siebt` `siebent` `acht` `neunt` `zehnt` `elft` `zwölft`  | `weiter` `zusätzlich` `primär` `sekundär` `ober` `unter` `inner` `äußer` `vorder` `hinter` `link` `recht` `ander`                                                     |

The German half is listed as **stems**: every one of them is generated with all five
adjective endings — `-e` `-en` `-er` `-es` `-em` — because that is what German actually
declines through (`das obere Gehäuse`, `des oberen Gehäuses`, `ein oberes Gehäuse`, `mit
oberem Gehäuse`, `einer oberer Welle`), across genders, cases and the plural alike. Both
halves are generated for the same reason: hand-listing is how the qualifiers once carried
only `obere`/`oberen` while `oberer`/`oberes`/`oberem` were missing, and a missing
inflection is not a missing feature — the term silently drops back to its base noun, which
then reads as an inconsistency the drafter never wrote.

**The two columns behave identically, and that is the point.** They were split for a while,
with only numberings droppable on a later reference, on the theory that a lost qualifier
might be a drafting slip. But a slip cannot be told from a deliberate shorthand, the sign
settles the reference either way, and a drafter drops "obere" exactly as readily as
"erste" — so the split cost a maintained table and bought nothing. `isOrd` is now the only
predicate, and it drives both the widening and the folding (see Cumulative References).

The split survives only as the two columns of this table, because the distinction is still
worth knowing when adding a word: a numbering is a pure index, a qualifier carries meaning.
What still catches a real slip is not the split but the **one-candidate rule**: a CHANGED
modifier ("upper" → "lower", "erste" → "zweite") is two widened terms under one sign, and
folding is refused wherever two exist. Only a DROPPED modifier is forgiven.

**A modifier may also be an excluded word.** `EXCL` (`constants.ts`) bars a word from being
the **base noun** — the word closest to the sign — and nothing more. `further` is in both
sets, and both readings of it are right: `a further 200 rivets are needed` registers no
term for 200 at all, while `a further shaft 20` is the two-word term `further shaft` and is
listed as such. `collectTermToks` therefore ends its backward walk on an excluded word
_unless_ that word is a modifier and the base noun is already in hand. Breaking on it
unconditionally is what made `further` dead vocabulary — it sat in `EN_ORD` where the walk
could never reach it.

`constants.test.ts` pins the vocabulary in both directions, so a stem added to
`EN_ORD`/`DE_ORD` fails the suite until this table names it too. It also asserts the five
inflections of several qualifiers **spelled out**, since checking a generated set against
the same cross-product would assert nothing, and keeps an inventory of the words in both
sets (`further`, and nothing in German) so that overlap stays a conscious choice.

### Cumulative References (`logic/cumulative.ts`)

A term introduced with a **distinguishing modifier** — a numbering like "erste"/"first" or
a qualifier like "obere"/"upper", one vocabulary — is routinely referred back to without
it, because the modifier only ever served to tell the siblings apart:

```
Die Vorrichtung umfasst eine erste Welle 10, eine zweite Welle 20 und eine dritte Welle 30.
Die Wellen 10, 20 und 30 sind koaxial zueinander angeordnet.
```

Read literally, the second line is three errors — sign 10 now carries two terms, the term
"Welle" now carries three signs, and a definite article introduces a term that was never
introduced — and all three are artefacts of a **correct** draft. The rule folds such an
occurrence into the widened term it refers back to, so none of the three is reported or
highlighted. "Das obere Gehäuse 12 … das Gehäuse 12" is the same case and folds the same
way.

**What makes a case sure enough to fold** (all four, or nothing happens):

- **The same sign.** This is the whole rule: "die Welle 10" can only be the thing "erste
  Welle 10" is. No proximity, plural or list heuristic is layered on top, because none of
  them would add certainty to what the sign already settles
- **Exactly the modifier dropped** — the widened term minus its first word, stem for stem
  (`erst well` → `well`). A term that lost anything else is a different term
- **The dropped word is a modifier** (`isOrd` — see The Modifier Vocabulary above), not any
  first word. A term the reference list spells out as `30 control unit` is the drafter's
  own declared vocabulary, so "the unit 30" departs from it rather than abbreviating it
- **One candidate.** A sign written as both "erste Welle 10" and "zweite Welle 10" — or as
  "das obere Gehäuse 12" and "das untere Gehäuse 12" — is itself the inconsistency the tool
  exists to report; with two widened forms there is no single term to fold into, so nothing
  is folded and the error stays visible. **A changed modifier is therefore still caught;
  only a dropped one is forgiven**, and that is what does the work the numbering/qualifier
  split used to be credited with

**What the folded occurrence keeps and loses.** It is still an occurrence of the sign,
still counted, and in claims mode still required to be written in parentheses — the rule
says what the term _is_, not how the sign may be written. It loses its own term entry, and
it stays out of three further things: the term's **raw spellings** (so the reference list
prints the widened form however often the short one is written — the count tie-break must
not be allowed to name sign 10 "Wellen"), the **article check**, and the positions that
check reads as evidence. That last pair is not tidiness: a German plural back-reference
takes "die" whatever gender the singular has, so leaving it in would invent a der/die/das
conflict on every masculine or neuter term.

One consequence worth knowing: a sign-less mention of the shortened form ("die Wellen sind
aus Stahl") is no longer a missing-sign finding, because the shortened form is not a term
of its own any more. A draft that never uses a modifier is unaffected.

The manual override still wins over everything: reducing the term takes the modifier off
every occurrence, so there is no widened form left to fold into and the real term-to-sign
conflict that produces is reported.

### Article Checking

- **Description mode**: flags definite articles on the **first use** of a term (should introduce with "a"/"an") and indefinite articles on **subsequent uses** (should use "the"). First use is determined by document position, not by the first occurrence that has an article
- **Claims mode (antecedent basis)**: "introduced" is evaluated **per claim chain**, not by document position. A term counts as introduced for an occurrence in claim C if it appeared earlier in C, anywhere in one of C's ancestor claims (transitive dependencies, including via ranges and "preceding claims"), or before the first claim. So a second independent claim may correctly say "a device" again, while "the seal" in a dependent claim whose chain never introduced a seal is flagged
- German gender-consistency checking (der/die/das conflicts) applies in both modes

## Data Flow

```
User Input (textarea — per-mode buffer)      Reference list (pasted or imported)
       |                                            |
       v                                            v
  tokenize() ──> Array of {word, start, end}   listTermIndex() ──> multi-word terms
       |                                            |
       v                                            |
  extractData() ←────────────────────────────────────
       |
       |
       ├─> {signData, termData, artErrors, bareTerms, numErrors, depErrors, noTermSigns}
       |             (claims mode also runs computeClaimGraph for deps + antecedent basis)
       v
  classify() ──> 'warn' | 'ok' for each sign
       |
       v
  buildHtml(text, result, …) ──> Highlighted HTML for backdrop overlay
                                 (marks carry data-sign attribute for hover)
```

`computeCrossRef` (in `logic/crossref.ts`) takes the two **already-computed** extraction
results and compares them — App memoizes `extractData` per buffer and passes both in. It
does not run extraction itself.

## localStorage Keys

| Key           | Purpose                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rsc_theme`   | Theme preference: `'light'`, `'dark'`, or `'system'`                                                                                                     |
| `rsc_mwo`     | Manual multi-word overrides (base stem → extra words; an explicit **0** means "base noun only" and outranks the reference list and the ordinal detector) |
| `rsc_desc`    | Description-mode text buffer (autosaved)                                                                                                                 |
| `rsc_claims`  | Claims-mode text buffer (autosaved)                                                                                                                      |
| `rsc_lang`    | UI/checking language: `'en'` or `'de'`                                                                                                                   |
| `rsc_mode`    | Active mode: `'description'` or `'claims'`                                                                                                               |
| `rsc_dis`     | Dismissed-error keys (JSON array; see `disKey` in `constants.ts`)                                                                                        |
| `rsc_reflist` | The drafter's reference-sign list, for the reference-list check                                                                                          |

All access goes through `hooks/usePersistentState.ts`.

## Known Limitations / Potential Improvements

### Data Persistence

- [x] Text content persists to `localStorage` (`rsc_desc`, `rsc_claims`) and restores on refresh
- [x] Language, mode and dismissed errors persist (`rsc_lang`, `rsc_mode`, `rsc_dis`)
- [x] Word `.docx` import (drag-and-drop + file picker) and round-trip export
- [x] The round-trip export is **verified** before it is handed over (`docx/verify.ts`)

### Known .docx limitations (deliberate, and each one visible rather than silent)

- An edited paragraph collapses to one run, so intra-paragraph formatting is lost **in
  edited paragraphs only**. The tooltip says so
- A buffer the source document has no section for cannot be written back — there are no
  paragraphs to splice into. Verification reports this rather than dropping it quietly
- A `.docm` exports under a `.docx` name while its content types still say
  macro-enabled. Harmless in practice, but the extension should follow the source
- `<w:sym>` (symbol-font characters) and field results (`<w:fldSimple>`,
  `<w:instrText>`) are not read, so a cross-reference field's rendered text is invisible
  to the checker
- A section break carried in a deleted paragraph's `<w:pPr><w:sectPr>` goes with the
  paragraph. Editing preserves it; deleting the paragraph does not
- Paragraphs inside tables are read as ordinary paragraphs, so a claim set laid out in a
  table imports as flat lines

### Export Features

- [x] Reference numeral list with copy-to-clipboard (plain text)
- [x] Reference-list **reconciliation** against the text (`logic/reconcile.ts`)
- [ ] Could add CSV/JSON export of sign-term mappings
- [ ] Could add copy-to-clipboard for error summary

### Keyboard Navigation

- [x] `Ctrl`/`Cmd`+`[` / `Ctrl`/`Cmd`+`]` for prev/next error (`hooks/useHotkeys.ts`)
- [x] `Ctrl`+`Shift`+`↓`/`↑` for prev/next error **about the same term**
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

- [x] Theme toggle is icon-only (sun/monitor/moon) with localized `title`/`aria-label` text (`themeLight`/`themeSystem`/`themeDark` in `i18n.ts`)
- [x] **Both palettes clear WCAG AA (4.5:1) on every surface they render on**, guarded by
      `logic/palette.test.ts`. Two tokens outright failed before: light `--accent` at
      2.66:1 (used as 10px text on the multi-word badge) and dark `--text-dim` at 2.70:1.
      Note `--surface2` is a card hover/focus background, so dim text has to clear that too
- [x] The test also pins the ramp ordering `text > text-muted > text-dim`. This is not
      hypothetical: lifting dim text far enough to pass AA on its own makes it _lighter_
      than the muted tier and inverts the hierarchy
- [x] `--info` (soft blue) for genuinely informational content — the claim-set panel, which
      must not look like an error
- [x] "All consistent" is an i18n key (`allConsistent`) in both languages

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
- [x] **The claim graph's transitive closure is no longer cubic.** `computeClaimGraph`
      merged every parent's whole closure into each claim, so a claim set written the
      ordinary way — "any one of the preceding claims", every claim depending on all the
      earlier ones — cost O(claims³). It now takes the parents highest-first and skips any
      already reached through an earlier one: ancestry is transitive, so a parent already
      in the set arrived with the whole of ITS closure, and merging that again can only
      re-add what is there. 400 claims: 190ms → 22ms, and 150 claims (the perf corpus)
      16ms → 6ms. The ancestor sets still hold O(claims²) numbers, which is the answer's
      own size rather than a way of computing it
- [x] **The per-occurrence allocations in the extraction scans are gone.** Three of them,
      each running once per sign occurrence — thousands of times on a real description, and
      showing up as garbage-collector time rather than as anything with a name:
      `collectOccurrence` built its term with `slice`/`map`/`join` (it now prepends onto the
      base noun, so the overwhelmingly common single-word term allocates nothing and reuses
      the stem already computed); `canonicalCumulativeTerms` split both the raw term and its
      stem before rejecting all but the modifier-led minority (it now reads the first word
      off the string); and `findBareTerms` re-split each candidate term stem for every token
      it tested (the index carries the split words). A 146KB description: 16ms → 13ms
- [x] **`isSignToken` branches on the first character** instead of trying both patterns. An
      Arabic sign starts with a digit and a Roman step with one of `IVXLCDM`, so an ordinary
      lowercase word — nearly every token in a document — is now rejected without either
      regex being entered. It runs over every token three times per extraction (ordinal
      detection, the main scan, the bare-term pass), which makes it the hottest predicate in
      the logic layer
- [x] `localStorage` writes are debounced. They ran on **every keystroke**, so a 200KB
      description serialised and stored 200KB per key press — a bigger typing-latency
      source than extraction, and not covered by the extraction debounce
- [x] Hovering a sign touches only that sign's marks (indexed per backdrop render), not
      every mark in the document
- [x] `Sidebar` and the card components are `React.memo`'d, with memoized list props and
      `useCallback`'d handlers. Note the ordering: memo alone skips **nothing** until the
      props are stable identities, so all three go together or none do
- [x] The `.docx` pipeline (and fflate) is lazily imported. Safe only because the service
      worker precaches the chunk — the rule for anything deferred here
- [x] **The easter-egg bee is lazily imported too** (`components/LazyBee.tsx`), by the same
      rule and with its chunk precached the same way. A plain dynamic import, not
      `React.lazy` — there is no Suspense boundary anywhere in this app
- [x] **The help screen too** (`components/LazyHelpDialog.tsx`), with its strings
      (`helpText.ts`) riding in the same chunk — it is opened by a click, and both
      languages of it shipped eagerly. The `?` button preloads on hover/focus. Note
      `build/budget.ts` has to learn each new lazy chunk, or the win is reported as a
      loss: the bytes leave the entry chunk and are counted against the critical path
      again under their own name
- [x] **No web fonts.** Six self-hosted `.woff2` files were 95.8 KB, 54% of the critical path
      and more than the framework and application code combined. Both faces are system
      stacks now (see Fonts). The mono stack backs the editor only; it must never be
      applied to what was proportional, or the UI turns monospace
- [x] **The stylesheet is inlined into `index.html`** (`build/inlineCss.ts`), removing a
      render-blocking request. The CSS asset is deleted from the bundle so the service
      worker does not precache a file nothing requests
- [x] **Preact via `preact/compat`** replaced React + ReactDOM: 45.23 KB gzipped → 7.64 KB.
      Viable because the API surface here is plain — the standard hooks plus `createRoot`
      and `StrictMode`, no portals, no Suspense, no `React.lazy`, no `flushSync`, no
      concurrent features. The whole suite runs through the same aliases, so it is the gate
- [x] **Framework and app code are separate chunks**, and `sw.ts`'s install carries an
      unchanged hashed chunk over from the previous build's cache instead of refetching it
      (the cache name carries the build id, so every deploy otherwise starts empty)
- [x] **The first extraction of a restored buffer is deferred past first paint**
      (`useDebounced`'s third argument). Both buffers came back from `localStorage` full and
      were extracted inside the very first render: measured in Chromium at 4× CPU throttle
      with two 112 KB buffers, the document appeared after **4199 ms**; deferred, it appears
      after **227 ms** and the highlights fill in behind it
- [x] A **payload budget** runs in CI (`npm run budget`): critical path 40.7 KB / 50 KB,
      whole precached shell 58.8 KB / 70 KB
- [x] **Terser, not esbuild, minifies the bundle** (`build.minify` in `vite.config.ts`).
      Three compress passes; `mangle` is names-only, because property mangling would
      rename the i18n keys and the `ERROR_KINDS` accessors, which are looked up by
      string. Worth 1.1 KB on the entry chunk and 0.35 KB on the lazy `.docx` one, for
      ~1.1s of build time — and it is the ONLY thing left that moves the critical path
- [ ] **The critical path is at its floor, and this was measured rather than assumed.**
      Every other candidate came back at zero or negative, so do not spend the effort
      again: deleting the ENTIRE German string table (far beyond any legal refactor)
      buys 2.24 KB, so i18n key-deduplication is worth ~0.2 KB; merging the duplicated
      CSS selectors saved 280 raw bytes and **10 gzipped**; folding the nine repeated
      `orphan-card` JSX trees into one component saved 440 raw bytes and **10 gzipped**;
      re-expressing the five `mark.h-*` rules as one rule plus `--mk` tokens made gzip
      **30 bytes worse**; and dropping `preact/compat` for bare preact plus a local
      `memo` came out **90 bytes worse** while sacrificing the React portability.
      The reason is uniform: gzip already collapses exactly the repetition that
      "remove the duplication" targets, and replacing repetition with indirection
      trades compressible text for novel tokens. There is no dead code and no dead CSS
      (checked). Refactor the duplication for maintainability — that is why the three
      shared components above exist — but do not expect bytes for it
- [x] Editor hover hit-testing is throttled to one `elementFromPoint` per animation frame
- [x] The reference list's multi-word terms cost one Map hit per sign occurrence: the
      index is keyed on the term's **last two words**, so a list naming three hundred
      "… element"s does not turn every occurrence into a hundred comparisons. Editing the
      list box re-runs extraction, so its input is debounced with the buffers and the
      index keeps its identity while its parsed content is unchanged
- [x] `perf.test.ts` covers the shapes it used to miss — a range/list-heavy corpus and a
      150-claim claims-mode set — plus a **ratio** test that fails on quadratic growth
      regardless of runner speed. The original single corpus contained no list constructs
      and never ran in claims mode, so two of the three quadratic paths were invisible to
      the guard written to catch exactly them. A **second ratio test grows the claim set**
      (100 → 400 claims), which is what the absolute 150-claim budget could not see: 150
      claims is small enough to hide a cube, so the closure above was cubic under a guard
      that stayed green. Its measurements are **the fastest of several runs**, because a
      perf guard asks "how fast can this go" and a single sample answers a different
      question — a GC pause or a scheduler preemption inflates it and never deflates it,
      which was the whole occasional-failure mechanism. The minimum drops those without
      weakening anything: a quadratic implementation has no fast run to find
- [ ] Very large documents may still lag in rendering (no virtualization)
- [ ] A Web Worker for extraction was considered and deliberately not added — post-optimization timings sit comfortably inside the 200ms debounce

### Additional Languages

- [ ] French patent applications are common
- [ ] Could add support for other European languages

### Sign Detection

- The sign pattern is centralized in `constants.ts` as `SIGN_RE` (Arabic) and
  `ROMAN_RE` (Roman steps); `isSignToken` accepts either, and the tokenizer and every
  extraction site share them. Sort sign lists with `compareSigns`: Arabic and Roman
  signs are **never interleaved** — all Arabic signs come first (by value, then
  suffix), all Roman steps are grouped at the end (`2`/`10`/`X`… then `I`/`I.1`/`II`).
- [x] **Bracketed paragraph numbers are ignored**: a number with a square bracket
      directly on either side (`[0012]`, `[0012]-[0015]`, `[18, 20]`) is a
      paragraph-number construct, not a sign — skipped by the main scan, ordinal
      detection and the range/list scan, and it does not satisfy a term for
      bare-term purposes (see `isBracketed` in `extract.ts`)
- [x] **Cross-reference words are excluded as terms**: a number preceded by a figure/
      claim/paragraph cross-reference word (`figure 14`, `figures 14 and 15`, DE
      `Figur 14`, `Figuren 14 und 15`, `Abbildung`/`Abbildungen`/`Abb.`, `claim`,
      `paragraph`, DE claim inflections `Anspruch`/`Ansprüche`/`Ansprüchen`/`Anspruchs`,
      …) is not registered under that word — the word is in `EXCL` (`constants.ts`),
      so the main scan and the range/list scan skip it. The range connectors are
      excluded too (`to` and its German parallel `bis`), so the second endpoint of
      `18 bis 22` shares the noun via range detection rather than taking `bis` as
      its term. `EXCL` governs the **base noun only**: an excluded word that is also
      a modifier may still qualify a term (`a further shaft 20` → `further shaft`,
      while `a further 200 rivets` registers no term) — see The Modifier Vocabulary
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
      qualify. See `signGroups` / `inParensAt` in `extract.ts`
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
npm test           # run the Vitest unit tests
npm run typecheck  # tsc over src/, build/ and the service worker (3 projects)
npm run format     # prettier --write . (CI runs format:check before the tests)
npm run build    # production bundle → dist/
npm run budget   # payload budget over dist/ (CI runs it after the build)
npm run preview  # serve the production build locally
```

Because the app uses native ES modules, run it through the dev/preview server (or the
live GitHub Pages site) — opening `index.html` directly from disk will not work.

### Deployment

`.github/workflows/deploy.yml` runs the tests and (on pushes to `main`) builds and
publishes `dist/` to GitHub Pages. The repo's Pages **source must be set to "GitHub
Actions"** in Settings → Pages. The Vite `base` is `/refcheck/` (project-site path).

### Dependencies

- Preact 10 + `preact/compat` (bundled, not CDN). Components import from `react`; the
  alias lives in `vite.config.ts`, so the app stays portable back to React
- fflate (zip read/write for `.docx`; bundled, ~8KB gzipped — the only non-React runtime dep)
- Vite + @preact/preset-vite (build); esbuild (a Vite dependency) type-strips the
  service worker — see build/swPrecache.ts
- terser (minifier). A devDependency rather than Vite's bundled esbuild minifier,
  for the 1.1 KB it takes off the critical path — see Performance
- Vitest (tests); jsdom + @testing-library/preact + user-event + jest-dom (UI tests),
  preact-render-to-string (the server-render smoke test — also what tsconfig's
  `react-dom/server` path points at, since preact/compat/server ships no declarations)
- TypeScript (checker only; nothing emits from it — Vite compiles the app and Node
  strips the types in build/*.ts by itself)
- No font dependency of any kind — both faces are system stacks (see Fonts)

### Testing

Run with `npm test` (currently **774 tests**). Logic tests run under the fast `node`
environment; only `*.ui.test.tsx` files run under `jsdom` (scoped via
`environmentMatchGlobs` in `vite.config.ts`, with `src/test/setup.ts` providing the
jest-dom matchers and `matchMedia`/`clipboard` stubs). The `include` glob covers
`build/` as well as `src/`, so the service-worker precache generator is tested too.

The whole app is **TypeScript** — there is no JavaScript left under `src/` or `build/`,
tests and the service worker included. `npm run typecheck` runs three projects and CI runs
it before the tests:

| Project              | Covers                        | Notes                                                              |
| -------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `tsconfig.json`      | `src/`, `build/`, vite config | `strict` + `noUncheckedIndexedAccess`                              |
| `tsconfig.test.json` | the test suite                | the same, with `noUncheckedIndexedAccess` off — see below          |
| `tsconfig.sw.json`   | `src/sw.ts` alone             | `lib: WebWorker` in place of DOM; the two cannot share one project |

**`noUncheckedIndexedAccess` is the flag this codebase actually needs**, and it was
measured rather than assumed: against the pre-migration logic layer, full `strict` cost 310
errors of which 309 were `noImplicitAny` (the annotation work the migration consists of
anyway), while this one cost 48. Nearly everything here is a map lookup (`signData[sign]`)
or a regex capture group (`m[1]`), and both type as present without it.

**It is off for tests, deliberately.** `expect(res.signData['12'].count).toBe(2)` is an
assertion ABOUT the fixture; requiring a guard there adds noise to every line and invites
the `?.` chains that turn a broken fixture into a passing test. Everything that catches real
mistakes in tests still applies — unknown properties, wrong arity, wrong types, unused
bindings. `src/test/helpers.ts` provides `must()` and `q()` in place of non-null assertions.

Because the map types are indexed under that flag, they carry **no redundant `| undefined`**:
write `Record<string, SignEntry>`, not `Record<string, SignEntry | undefined>`. The flag
supplies it in production and its absence is what makes the tests readable.

Two constraints are worth knowing before adding a union, because both cost real time to
rediscover:

- **A union member whose discriminant is a union of literals is never narrowed away.**
  `ErrorSpan` therefore splits `SignSpan` (`kind: 'sign'`) and `SignTermSpan`
  (`kind: 'signTerm'`) into two members instead of one carrying `'sign'|'signTerm'`.
  With the combined form, `getAllErrors` cannot reach `sp.item` after excluding both sign
  kinds without an assertion. This was previously recorded here as a JSDoc limitation. It
  is not — plain TypeScript behaves identically, verified with a minimal repro during the
  migration (see docs/typescript-migration.md).
- **A boolean discriminant DOES narrow**, contrary to what this file used to say.
  `exportPatentDoc` tests `!can.ok`; the old `'reason' in can` really was a JSDoc-only
  workaround.

`docs/typescript-migration.md` records what the migration changed, the bug the compiler
found in the service worker, and the smaller things it surfaced along the way.

Formatting is enforced: `.prettierrc` exists and CI runs `npm run format:check` before
the tests. Keep it green — 51 of ~55 files once violated the repo's own config because
nothing checked.

Coverage by area:

| File                             | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tokenize.test.ts`               | word/number spans, trailing-letter (`12a`) & **prime (`10'`,`10′`)** signs, **Roman steps/substeps (`II`, `I.1`) + word-fallthrough (`In`, `Die`)**, German letters/hyphens, >5-digit runs, glued word+number, decimals, **CRLF spans**, repeat-call safety                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `stem.test.ts`                   | EN Porter steps (`-s`/`-ies`/`-ing`/`-ed`/`-tion`, `-ss` retention, short words), DE Snowball (plurals, umlaut folding, case), dispatch + EN fallback, **cache transparency across an eviction and per-language isolation**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `constants.test.ts`              | `likelySign`, `isClaimNumber` (terminators, indented, parens, mid-sentence, none, **Roman `I.` guard**, **CRLF**), `isSignToken` (prime/letter/range, **Roman + malformed rejection**), **`romanToInt`/`signVal`**, `compareSigns` (**Roman ordering, Arabic-before-Roman grouping**), article helpers, **the modifier vocabulary — that `isOrd` accepts numberings and qualifiers alike, that all five inflections of a German qualifier (`oberer`/`oberes`/`oberem`, not just `obere`/`oberen`) and every ordinal up to `zwölfte` are present while the cardinal `acht` is not, a two-way pin of `EN_ORD`/`DE_ORD` against the table in CLAUDE.md, and that no modifier also sits in `EXCL` (where the term walk would stop before ever reaching it)**, **`disKey`** — the declared source of truth for dismissal keys, which had no direct test at all while every dismissal test hard-coded the literals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `extract.test.ts`                | sign/term consistency & inconsistencies, **term identity case-folded while sign detection is not** (three casings of one English term reading as one term with one lowercase spelling, a capitalised bare occurrence found under the same stem, and the deliberate asymmetry that only an UPPERCASE Roman numeral is a step), claims parentheses, claim-numbering (+ stable keys, CRLF), article errors (EN+DE), DE gender conflict, ordinal multi-word + `mwo` + `detectOrdStems` guards, **German qualifier inflections widening a term in every case, gender and number (nominative, genitive, dative, plural) and a shortened reference folding into whichever one introduced it**, **an excluded word qualifying a term but never being its base noun (`a further shaft 20` vs `a further 200 rivets`, including the fold and the two negatives `said`/`comprising`)**, bare terms, **prime signs**, **Roman step/substep signs + conflicts**, **ranges (to/bis/and/und/or/oder/through/dash/semicolon, EN+DE, with negatives, figure-word exclusion, `bis`/`Ansprüchen` never a term)**, **parenthesised sign groups**, **`noTermSigns`**, **bracketed paragraph numbers (`[0012]`) — now unit-tested directly**, **per-claim antecedent basis**, **claim dependency errors**, **`autoMW = false`** (previously never exercised by any call site), **multi-word terms from the reference list** (extension in both modes and in ranges, a different modifier left alone, bare occurrences reported as the whole phrase, DE, and both directions of the manual override — a reduction beating the list AND the ordinal detector), **cumulative references** (the widened term kept as the sign's only term EN+DE, the whole passage reporting nothing, the shortened occurrence still counted and marked `cumulative`, order independence, a dropped QUALIFIER folding exactly like a dropped numbering, no invented der/die/das conflict, antecedent basis in claims mode, the modifier taken from the reference list) **and the cases that stay errors** (a CHANGED modifier, a term the reference list itself spells out, two modifiers under one sign, a genuinely different term, a bare noun under a sign that never carried one, and a manual reduction winning with its conflicts intact) |
| `claims.test.ts`                 | `segmentClaims` spans, `parseClaimRefs` (positions, offsets, lists, range expansion, DE, "preceding claims", trailing-comma negatives), `computeClaimGraph` (transitive ancestors, range/preceding ancestry, missing/forward/self typing, duplicate keys, acyclicity, and that the parent-skipping closure still returns the FULL ancestor set on a diamond and on a chain reached through two parents)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `crossref.test.ts`               | null/agreement, missing-in-desc/claims, numeric sort, sign & term conflicts, **`notIntroducedInDesc`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `buildHtml.test.ts`              | empty input, warn/data-sign marks, numbering + dependency highlights, dismissed→`h-dis`, focus class, escaping, non-overlapping marks, **strip-marks ≡ esc(text) + trailing-newline sentinel (alignment invariant)**, **trailing-newline sentinel appended (vertical alignment)**; `findAtPos` (sign, article, **bare term**, and that a sign-attached occurrence is not reported as bare)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `scrollSync.test.ts`             | `backdropScroll`: in-range pass-through, overscroll past the bottom and the top split into clamped part + shift, content shorter than the box, missing geometry (no `NaN` reaching a transform), sub-pixel exactness — plus that `styles.css` still carries `overscroll-behavior: none` on the editor layers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `reflist.test.ts`                | `buildRefList` (sort, dominant term, primes, empty), **that a term referred back to without its numbering is listed under the NUMBERED form even when the short one is written three times as often**, `toPlainText`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `headings.test.ts`               | normalization (leading `III.`/`B)` labels, trailing colon, NBSP, the `I claim` guard), every dictionary entry round-tripping to its own kind, the **`BRIEF DESCRIPTION` vs `DESCRIPTION OF THE DRAWINGS` collision**, and negatives — a sentence mentioning "Ansprüche" and an over-long line must NOT match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docx/read.test.ts`              | entity decoding, **run joining with no separator** (`hous`+`ing`), `xml:space="preserve"`, tab/br, **noBreakHyphen/softHyphen read as U+2011/U+00AD**, empty paragraphs, pStyle/numPr/bold (incl. `w:val="0"`), **text-box exclusion**, **tracked insertions kept / deletions dropped**, xml spans + pPr/rPr capture, header/footer/comment parts excluded, `notZip`/`noDocument` errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docSplit.test.ts`               | EN + DE slicing, abstract/figure-listing/Bezugszeichenliste exclusion, heading-derived language, **auto-number synthesis** (per-`numId` counters, already-numbered left alone, multi-level flagged), no-heading and claims-only fallbacks, blank-edge trimming, a description whose prose mentions "Ansprüchen", **the sign list returned separately as `signList`**, and **that the three section ranges are always disjoint** — claims before the description, sign list before the description, and that a German `Ausführungsbeispiel 2` subheading does NOT truncate the description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docx/write.test.ts`             | `planEdits` no-op on unchanged text, round trip: edit applied, **untouched paragraphs and other zip parts byte-identical**, pPr/rPr preserved, **synthesized claim numbers stripped**, XML escaping, `<w:br/>` paragraphs, appended paragraphs, re-import equals the edit, `createDocx`; plus **claim alignment**: an inserted claim gets its own paragraph (no `<w:br/>`) with the neighbours' `pPr`, an inserted claim on a list is numbered by Word and carries no typed number, a renumbering edit strips the typed number, an append past the end is not double-numbered, claim text never lands in a blank spacer, a clone comes from a real claim when the last paragraph is blank, an added blank line stays out of the numbering, and the file re-imports to the buffer; plus **numbering style**: a Word-list source exports every claim as a list item with no typed number left in the text (including a claim that lands in a plain trailing paragraph, and one appended past the end), a typed-number source exports no `<w:numPr>` at all, a lead-in line stays out of the list, and a numbered DESCRIPTION line is left as prose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docx/lineDiff.test.ts`          | `alignLines` (same/changed/deleted/appended/inserted) and **the LCS size bail-out** — note it trims the common head and tail _before_ measuring, so a single-edit case never reaches the degraded path however long the documents are                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `docx/claimNumbering.test.ts`    | `isClaimLine` (incl. a Roman step and an over-long number as negatives), `stripAutoNumber` on a renumbered list item vs typed text, `claimListTemplate` (found / typed-numbers / multi-level), `conformClaim` (joins the list and drops the typed number, leaves a lead-in alone, un-lists when numbers are typed, never touches `ilvl > 0`), `NUMPR_RE` on both element forms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docx/xmlText.test.ts`           | C0 controls dropped and tab/newline kept, CR dropped, U+FFFE/U+FFFF dropped, surrogate pairs kept but lone surrogates dropped (including a lone one adjacent to a real pair), strip-then-escape ordering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docx/verify.test.ts`            | accepts what the export does on purpose (unchanged doc, ordinary edits, **claim numbers Word will renumber**, trimmed blank edges, a dropped invalid character) and catches what it should (claims a source has nowhere to put, the FIRST differing line, an unreadable file). Both directions matter: a verifier that cries wolf gets ignored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `docx/integrity.test.ts`         | the promises that are not any one feature: **an insertion and a replacement meeting at one offset** (the malformed-XML regression), `orderSplices` ordering + overlap/bounds refusals, **sections that would otherwise overlap**, **characters XML cannot hold** and a CRLF buffer not rewriting every paragraph, **noBreakHyphen surviving an edit**, every other zip part **byte-identical** (not merely present), document.xml identical outside the edited paragraph, nothing written when nothing changed, and `exportPatentDoc`'s verification results                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `detectLang.test.ts`             | EN/DE prose, umlaut signal, empty input, **headings beat text**, text fallback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `importDoc.test.ts`              | `fileKind` (`.docx`/`.docm`/legacy `.doc`/other), import returns buffers+lang+provenance, round-trip vs fresh export, DE fresh export heading                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `beeFlight.test.ts`              | spawn off each of the four edges, entering/`entered`, jagged path (heading reversals), bounded speed, lifespan → `leaving`, exit through any side, hard age cap, `countBees` (word boundary, plural, `beetle` negative, DE `Biene`/`Bienen` gated on language, `Bienenstock` negative)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `i18n.test.ts`                   | EN/DE key parity + matching value types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `palette.test.ts`                | contrast of every foreground token against `--bg`/`--surface`/`--surface2` in both themes at the 4.5:1 AA bar, plus the `text > muted > dim` ramp ordering, **text on a coloured fill (`--on-accent` on `--accent`)**, and two stylesheet scans: **no rule may dim text with a partial `opacity`** (it composites text AND surface against what is behind, and turned a 4.59:1 pair into 3.05:1), **no rule may paint text with a literal colour** (a non-token is outside the matrix by construction). Contrast is invisible to every other kind of test — a Lighthouse run found two failures this file passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `errorKinds.test.ts`             | The registry's invariants: unique ids, **the historical dismissal prefixes (`s:` `a:` `b:` `n:` `d:`) — the storage-format guard, which is the one thing a naive "simplification" here would break silently**, the historical `getAllErrors` property names, a field the extractor actually fills, well-formed spans, term-vs-null per kind, a non-empty message in both languages, i18n keys that exist, search predicates that reject a non-match, and **both colour tokens defined in both themes** (the card takes its colour from those, so they are the entire stylesheet cost of a category)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ctxMenuItems.test.ts`           | The editor's right-click menu, which previously could only be exercised by mounting the app: nothing actionable at the caret, sign vs bare term vs article, reduce offered only once a term is wider than its base noun, insert-sign offered for one sign and withheld for two, **the sign correction — offered on the odd occurrence (from the term span as well as the sign), withheld on the ones that agree and on an even split**, dismissed entries flipping to Restore, restore-all appearing only when something is dismissed, and German labels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `errorSpans.test.ts`             | severity per sign, `signTerm` spans only for warned signs, a dismissed sign kept as `dis` for the backdrop while the navigator drops it, all five categories, document order, **the `term` each error names (a sign by the term of ITS occurrence, `null` where there is none)**, **`errorGroup` bucketing — one term's errors together, two terms apart, term-less errors by category**, **a cumulative back-reference producing no navigable error and highlighting under the numbered term** — **and that every highlight class the logic emits is actually defined in `styles.css`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `reconcile.test.ts`              | `parseRefList` (separator forms, multi-word terms, primed/suffixed signs, non-list lines skipped, duplicates) and `reconcileRefList` (clean list, listed-not-used, used-not-listed, term mismatch, plural/case tolerance, numeric sort, DE, **a listed numbered term the text also refers to without its numbering — reported as a match, not a mismatch**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `cumulative.test.ts`             | The rule that suppresses the shortened-term noise, in isolation: what it folds (same sign, German inflections, a multi-word base, a qualifier exactly like a numbering, each sign against its own modifier, either document order) and — the half that matters — **what it refuses to fold** (across signs, a CHANGED modifier, a first word that is not a modifier, a sign with two modifiers, a term that lost more than its modifier, a different noun, the wrong language, a raw/stem length disagreement). `cumKey` cannot collide whatever either half contains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `signFix.test.ts`                | `suggestSign`: the majority proposal, and every refusal that keeps it an offer rather than a guess (the occurrence already carrying the usual sign, an even split, a tie between two alternatives, a one-sign term, an unknown term) — plus one case read off a real extraction rather than hand-built data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `listTerms.test.ts`              | `listTermIndex` (multi-word entries only, punctuation and stray signs dropped, stemmed duplicates collapsed, over-long phrases ignored, DE, and that layout-only edits keep the same `sig` while a real term change does not), `listExtra` (match, longest-wins, a different modifier, inflections, phrase longer than the words available) and `appliedListTerms` (list order, and a hand-reduced term dropping out)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `claimStats.test.ts`             | independent/dependent counts, multiple dependency, a range counting as ONE multiply-dependent claim, depends-on-multiple, chain depth, each DPMA/EPO threshold at and past its boundary, the two offices reported independently, and that **no USPTO threshold is ever emitted**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `swPrecache.test.ts`             | precache list contents (base URL included, sw.ts excluded, unhashed assets added, lazy chunk covered), build-id stability, and that a missing placeholder **throws** rather than shipping a worker that caches nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `swInstall.test.ts`              | the SHIPPED `src/sw.ts` install handler, rendered through the build substitution and run against a fake CacheStorage: a first-ever install fetches the whole shell, a second deploy carries the unchanged hashed chunk over instead of refetching it (and the new cache really holds it), the navigation/manifest/icon are always refetched, and a non-2xx rejects the install rather than reporting a half-filled cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `inlineCss.test.ts`              | `inlineStylesheets`: the link becomes an inline `<style>` in the same position (cascade order), which hrefs were consumed so the caller can drop those assets, a link the bundle does not own is left alone rather than silently dropped, and `rel="icon"` is not mistaken for a stylesheet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `useDebounced.ui.test.tsx`       | pass-through at delay 0 with no extra render, the debounce itself, and the **deferred first render**: the placeholder on the first render of a big value, the handover on the first effect rather than after the delay, no deferral when the value is small enough to pass through, and ordinary debouncing afterwards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `usePersistentState.ui.test.tsx` | init/fallback, immediate vs debounced writes, burst coalescing, flush on pagehide and visibilitychange, quota failure reported not swallowed, private-mode degradation, all three codecs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `useHotkeys.ui.test.tsx`         | mod/Cmd equivalence, firing from inside the editor, suppression of unmodified bindings while typing, named keys, case-insensitivity, disable, handler swap without re-binding, unmount cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `useFileDrop.ui.test.tsx`        | nested dragenter/dragleave balancing, **dragleave with types hidden**, **dragend on an abandoned drag**, drop delivers the file, dragover preventDefault                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `useEditorSync.ui.test.tsx`      | that the layer-alignment effect reads **no editor geometry at mount** (counting the reads, since the misalignment it would cause is invisible), that a backdrop re-render before any scroll reads none either, and that both halves of the large-paste case still do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `perf.test.ts`                   | a >100KB plain description, **a >100KB range/list-heavy one**, **a 150-claim claims-mode set**, **a 300-entry reference list whose entries all share three base nouns** (the shape a base-noun-only index would choke on), and **two ratio tests that fail on superlinear growth regardless of runner speed** — one growing the list constructs, one growing a preceding-claims chain (100 → 400 claims), which is the shape the absolute 150-claim budget was too small to catch a cubic closure in. Every ratio measurement is the fastest of several runs, so a GC pause or a scheduler preemption on a shared runner cannot fail a guard that only asks how fast the code can go. The original corpus had no list constructs and never ran in claims mode, so two of the three quadratic paths were invisible to it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `App.ui.test.tsx`                | (jsdom) typing populates sidebar, dismiss removes warning, **collapsible card section toggles open/closed**, nav cycles, **click-to-cycle through a sign's occurrences (+ unfocus after last)**, RefList copy, persistence restore + reset, mode switching preserves buffers, cross-ref section, dependency card + dismissal, context-menu term extension, **the bare-term context menu** (offers extend / insert-sign / dismiss, writes the sign in — bracketed in claims mode, offers none when the term has two signs, dismisses, extends from a sign-less occurrence), **correcting a mistyped sign** (the rewrite lands on the right occurrence, the inconsistency clears, the caret follows the edit, and nothing is offered on the occurrences that agree), language/theme toggles + persistence, dismissed-error restore, **dropped `.docx` fills both buffers + switches language + reconstructs claim numbers**, **import undo**, **export downloads the edited bytes silently when it verifies and warns with the differing line when it does not**, **legacy `.doc` rejection**, **the bee** (EN/DE bubble, no bee for a restored buffer, survives continued typing, beats reduced-motion on explicit request, two bees, no bee on language switch), **keyboard: Ctrl+[/] error nav, **same-term nav (Ctrl+Shift+↓/↑ skips the other term, wraps, follows a clicked card, stays put when the term has one error)**, Enter/Space on a card, `/` focuses the filter but not while typing, `aria-expanded`, landmarks, `<html lang>`**, **reference-list check** (match, term mismatch, stale + missing entries, persistence, auto-fill from a `.docx`), **multi-word terms from the list** (a pasted list widens a term and the panel says so; the context menu reports the width as displayed and reduces it back, storing an explicit 0; an imported `.docx` sign list widens terms in BOTH buffers), **claim-set statistics**                                                                                                                                                                                                                                                                                                                                                             |

Manual smoke test — `npm run dev`, then paste into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Expected: Signs 10, 12, 14, 18 appear in the sidebar as "Consistent". Pasting
`The housing 12 is connected to the casing 12.` should flag sign 12 as an
inconsistency showing both "housing" and "casing".
