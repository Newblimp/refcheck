# Reference Sign Checker (RefSign Checker)

A browser-based tool that validates reference-sign consistency in patent applications.
Preact + Vite, deployed to GitHub Pages, fully client-side and offline-capable after the
first load.

## Purpose

A patent draft must keep its reference signs (`10`, `12a`, `I.1`) and their terms
("housing", "cover") consistent. The tool reports:

1. **Inconsistent sign → term** (one sign, two terms) and **term → sign** (one term, two signs)
2. **Article errors** — definite vs indefinite (`the`/`a`, `der`/`ein`), plus German gender
   consistency; in claims mode this is a per-claim-chain **antecedent basis** check
3. **Claims formatting** — signs not written in parentheses
4. **Missing signs** — a known term written without its sign
5. **Cross-reference** — signs in the description but not the claims, or vice versa
6. **Claim numbering and dependencies** — gaps, references to nonexistent/later/own claims
7. **Reference-list drift** — the draft's own list of signs disagreeing with the text
8. **Claim-set structure** — counts, multiple dependency, DPMA/EPO fee thresholds (information, not errors)

What it must NOT report matters as much: a checker that cries wolf gets switched off. The
clearest case is **Cumulative References** below ("erste Welle 10 … die Wellen 10, 20 und
30" reads as three errors and is correct drafting).

## Architecture

- Written against the **React API** and compiled by `preact/compat` (aliases in
  `vite.config.ts` and `tsconfig.json` `paths`; components import from `react`). Plain
  hooks plus `createRoot`/`StrictMode` only — no portals, Suspense, `React.lazy`.
- **`src/logic/` is pure and DOM-free** and is unit-tested under the `node` environment.
  Nothing outside `logic/` imports fflate or touches OOXML; that seam keeps the suite fast.
- The production bundle is built to `dist/` and published by `.github/workflows/deploy.yml`
  (Pages source must be "GitHub Actions"; `VITE_BASE=/refcheck/` is set only there).
- Styling is one stylesheet with CSS custom properties per theme, inlined into `index.html`
  at build time.

```
index.html              Shell: inline theme script (no flash), manifest/icon links, empty
                        #root (a static shell measured ~20 ms SLOWER to first paint; do not
                        add one back without re-measuring). Comments here are stripped at
                        build time — index.html is the one critical-path file that is not
                        minified, and a paragraph for the maintainer was 0.5 KB gzipped
build/
  inlineCss.ts          Vite plugin: folds the stylesheet into index.html, deletes the .css
                        asset and strips HTML comments. Must run BEFORE swPrecache reads
                        the bundle keys
  swPrecache.ts         Vite plugin: type-strips src/sw.ts and injects the asset list + a
                        build id into dist/sw.js. Strip FIRST, substitute second
  budget.ts             Payload budget (npm run budget, in CI after the build). Knows the
                        lazy chunks by name — a new lazy chunk must be added to LAZY or its
                        bytes count against the critical path under their own name
public/                 manifest.webmanifest, icon.svg (PWA install)
src/
  main.tsx              Mounts <App/>, imports styles.css, registers sw.js (prod only)
  sw.ts                 Hand-rolled service worker (precached shell). Ships as a classic
                        script at an unhashed URL, so it is NOT bundled
  styles.css            All styles. NO web fonts: --font-ui / --font-mono are system stacks
  i18n.ts               EN/DE UI strings (T). DE is typed against EN, so a missing key or a
                        drifted formatter is a compile error
  helpText.ts           The help screen's strings, in the lazy HelpDialog chunk
  assets/bee.svg        Noto Color Emoji bee (Apache-2.0), vendored — no CDN
  logic/
    constants.ts        Lang/Mode types, EXCL, article sets, the modifier vocabulary
                        (EN_ORD/DE_ORD), SIGN_RE/ROMAN_RE/isSignToken/compareSigns,
                        CLAIM_NUM_PREFIX_RE, CONNECTOR_ALT/RANGE_DASHES, disKey
    tokenize.ts         tokenize() (module-level regex; lastIndex reset per call)
    stem.ts             stemEn (Porter) / stemDe (Snowball) / stem() — memoized per language
    extract.ts          extractData + classify; the ExtractResult interfaces. Scans collect
                        occurrences, buildFromOccurrences settles terms in a second pass
    cumulative.ts       canonicalCumulativeTerms — which shortened terms are back-references
    claims.ts           segmentClaims / parseClaimRefs / computeClaimGraph
    claimStats.ts       claimStats + THRESHOLDS (counts, not currency; European only)
    crossref.ts         computeCrossRef over two already-computed extraction results
    reflist.ts          buildRefList / toPlainText (the derived numeral list)
    refListParse.ts     parseRefList — reads a drafter's reference-sign list
    listTerms.ts        listTermIndex / listExtra / appliedListTerms — multi-word terms
                        from that list, indexed on the LAST TWO words
    reconcile.ts        reconcileRefList — list vs text, stem-compared
    errorKinds.ts       ERROR_KINDS — the table of the four non-sign categories; Focus,
                        sameFocus
    errorSpans.ts       eachErrorSpan / getAllErrors / errorGroup — ONE walk over errors
    buildHtml.ts        buildHtml (backdrop markup) + findAtPos (what sits at the caret)
    findText.ts         findText / matchFrom / MAX_MATCHES (Ctrl+F)
    ctxMenuItems.ts     What the right-click menu offers — pure, per-category on purpose
    signFix.ts          suggestSign — the sign a term usually carries
    scrollSync.ts       backdropScroll (overscroll split) + centerOffset
    escape.ts           escapeMarkup (HTML/XML text)
    blankEdges.ts       blankEdges / trimBlankEdges — docSplit and docx/write MUST agree
    fileKind.ts         fileKind alone, so classifying a drop needs no .docx chunk
    headings.ts         SECTION_KINDS + EN/DE heading dictionary (data) + matchHeading
    docSplit.ts         splitPatentDoc — document model → disjoint section buffers
    detectLang.ts       detectLang (headings first, stopwords second)
    importDoc.ts        importPatentDoc / exportPatentDoc — the seam App calls (lazy chunk)
    docx/read.ts        readDocx / docxXmlToParagraphs — the ONLY OOXML-aware reader
    docx/write.ts       planEdits / orderSplices / writeDocx / createDocx
    docx/lineDiff.ts    alignLines — which imported line became which edited line
    docx/claimNumbering.ts  conformClaim — Word list numbers vs typed numbers
    docx/xmlText.ts     xmlText — the ONLY producer of <w:t> content
    docx/verify.ts      verifyExport — re-reads the file and compares with the buffers
    docx/fixture.ts     Test helper: real .docx bytes in memory; xmlFault checks
                        well-formedness (the reader is a tag scanner and cannot)
    beeFlight.ts        The bee's motion model (lazy chunk only — nothing eager imports it)
    beeCount.ts         countBees, alone, because useBee runs it on every settled keystroke
  hooks/
    useDebounced.ts     Debounce; delay 0 passes through; `initial` defers the first render
    useEditorSync.ts    The imperative half of the editor: scroll mirroring, mark index for
                        hover, scroll-to-span, caret restore. The only DOM-touching code
    useDocumentIO.ts    The .docx round trip (import, export, undo, banner report). Reads
                        the buffers through `buffers`, writes through `apply`
    usePersistentState.ts  useState + localStorage (jsonCodec / setCodec / oneOf; optional
                        debounce with flush on pagehide/visibilitychange, onError)
    useTheme.ts, useFileDrop.ts, useBee.ts, useHotkeys.ts
  test/setup.ts, helpers.ts (must()/q()/maybe()), globals.d.ts
  components/
    App.tsx             State and wiring, editor pane
    TopBar.tsx, StatusBar.tsx, FindBar.tsx, Sidebar.tsx, RefPane.tsx, RefListCheck.tsx,
    ClaimStats.tsx, ImportBanner.tsx (also carries the storage-full report),
    DropOverlay.tsx, CtxMenu.tsx, HelpDialog.tsx (lazy) / LazyHelpDialog.tsx,
    Bee.tsx (lazy) / LazyBee.tsx
    Section.tsx         The collapsible ▾/▸ header every list in both panes uses; an
                        optional `action` sits beside it (the reference list's Copy)
    SignCard.tsx        A sign with its term chips — each chip is a BUTTON cycling that
                        term's occurrences alone
    ErrorCard.tsx       ONE card for the four non-sign categories, driven by its row
    RefList.tsx         The derived numeral list (a Section) + copy
    OrphanCard.tsx, StatCell.tsx, DismissButton.tsx, icons.tsx, cardProps.ts (activatable)
    App.smoke.test.tsx  Server-render smoke test (node); App.ui.test.tsx (jsdom)
```

### Core functions

| Function                                                             | Module                                                | Purpose                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tokenize()`                                                         | `logic/tokenize.ts`                                   | Text → word/number tokens with spans                                                            |
| `extractData(text, lang, mwo, autoMW, isClaims, listIdx)`            | `logic/extract.ts`                                    | Signs, terms, article/bare/numbering/dependency errors, `noTermSigns`, `claimGraph`             |
| `classify()`                                                         | `logic/extract.ts`                                    | `'warn'` / `'ok'` for a sign                                                                    |
| `canonicalCumulativeTerms()`                                         | `logic/cumulative.ts`                                 | Shortened term → the modified term of the SAME sign it refers back to                           |
| `isOrd()`                                                            | `logic/constants.ts`                                  | Is this word a distinguishing modifier (see the vocabulary table)                               |
| `suggestSign()`                                                      | `logic/signFix.ts`                                    | The majority sign for a term, or null when the evidence is not one-sided                        |
| `ERROR_KINDS` / `sameFocus()`                                        | `logic/errorKinds.ts`                                 | The category table; whether two focus values (chip included) name the same thing                |
| `eachErrorSpan()` / `getAllErrors()` / `errorGroup()`                | `logic/errorSpans.ts`                                 | One walk over every error; the navigator's list `(result, mode, dis)`; the same-term bucket     |
| `buildHtml(text, result, mode, dis, focusSign, find?)`               | `logic/buildHtml.ts`                                  | Backdrop markup; `findAtPos` names the sign/article/bare term at a position                     |
| `findText()` / `matchFrom()`                                         | `logic/findText.ts`                                   | Literal case-insensitive matches; which one a search starts on                                  |
| `ctxMenuItems()`                                                     | `logic/ctxMenuItems.ts`                               | The right-click menu for what `findAtPos` found                                                 |
| `computeClaimGraph()`                                                | `logic/claims.ts`                                     | Claim spans, refs, transitive `ancestors`, `depErrors`, `direct` parents                        |
| `claimStats()`                                                       | `logic/claimStats.ts`                                 | Counts, multiple dependency, DPMA/EPO thresholds                                                |
| `computeCrossRef()`                                                  | `logic/crossref.ts`                                   | Description ↔ Claims comparison of two results                                                  |
| `buildRefList()` / `parseRefList()` / `reconcileRefList()`           | `logic/reflist.ts`, `refListParse.ts`, `reconcile.ts` | Derived list; the drafter's list; the diff between them                                         |
| `listTermIndex()` / `listExtra()` / `appliedListTerms()`             | `logic/listTerms.ts`                                  | Multi-word terms from the list (`sig` = content signature); how many extra words; which applied |
| `isSignToken()` / `compareSigns()` / `signVal()`                     | `logic/constants.ts`                                  | What counts as a sign (Arabic or Roman step); sort — all Arabic first, Roman grouped last       |
| `isClaimNumber()` / `startsWithClaimNumber()` / `stripClaimNumber()` | `logic/constants.ts`                                  | Line-leading claim numbers — docSplit and the writer must agree exactly                         |
| `backdropScroll()` / `centerOffset()`                                | `logic/scrollSync.ts`                                 | Overscroll split; where to scroll so a span lands mid-editor                                    |
| `matchHeading()` / `splitPatentDoc()` / `detectLang()`               | `logic/headings.ts`, `docSplit.ts`, `detectLang.ts`   | Section detection, buffer split, language                                                       |
| `readDocx()` / `writeDocx()` / `planEdits()` / `orderSplices()`      | `logic/docx/read.ts`, `write.ts`                      | The OOXML edge                                                                                  |
| `alignLines()` / `conformClaim()` / `xmlText()` / `verifyExport()`   | `logic/docx/*`                                        | Line diff; claim-number placement; legal `<w:t>` text; read-back check                          |
| `importPatentDoc()` / `exportPatentDoc()`                            | `logic/importDoc.ts`                                  | The seam App calls (lazy)                                                                       |
| `spawnBee()` / `stepBee()` / `beeGone()` / `countBees()`             | `logic/beeFlight.ts`, `beeCount.ts`                   | The easter egg                                                                                  |

## Features

### Modes

- **Description** and **Claims**, each with its own buffer; the mode buttons show a dot
  when their buffer has text
- Claims mode additionally requires signs in parentheses — a group such as `(6, 12; 13)`
  counts for every sign inside — validates claim numbering/dependencies and switches
  article checking to antecedent basis

### Claim dependencies (claims mode)

- `claims.ts` segments the buffer on the line-leading claim numbers and parses references:
  `according to claim 3`, `of claim 1 or 2`, `any one of claims 1 to 4`, `nach Anspruch 3`,
  `nach einem der Ansprüche 1 bis 4`, `preceding claims` / `vorhergehenden Ansprüche`. EN
  and DE patterns are always both parsed
- `depErrors`: references to **nonexistent**, **later** or the claim's **own** number, each
  with an edit-stable key (`claim>ref#ordinal`). Ranges expand into intermediates for the
  graph but only the literally written numbers are validated/highlighted. Bad references
  never create edges, so the graph is acyclic by construction
- The transitive closure takes parents highest-first and skips any already reached (a
  parent in the set arrived with its whole closure): O(claims²) rather than cubic on the
  ordinary "any one of the preceding claims" shape

### Cross-reference

- With both buffers non-empty, a sidebar section lists signs present in one and absent from
  the other, sign/term conflicts across buffers, and `notIntroducedInDesc` — claims signs
  that appear in the description only **bare** (mutually exclusive with `missingInDesc`)

### Word (.docx) import and export

- **Import**: drag a `.docx` anywhere (handlers on `window`, `preventDefault` on `dragover`
  AND `drop`, or the browser opens the file) or the Import button. Legacy `.doc` is
  rejected with a message. The drop overlay is `pointer-events:none` so the editor's
  `elementFromPoint` hover hit-testing keeps working
- **Sections come from dedicated heading lines only.** A paragraph qualifies when its
  ENTIRE text is a heading (after stripping a leading `III.`/`B)` label and a trailing
  colon). Description = after a `detailedDesc` heading up to the claims/sign list; Claims =
  after a `claims` heading up to the sign list/abstract. The abstract, figure listing and
  Bezugszeichenliste are excluded by construction; the sign list is returned as `signList`
  and fills the reference-list check
- The heading dictionary in `headings.ts` is data (add French = add an `fr` key). Exact
  whole-line matches cannot collide; the longest-first prefix fallback applies only to
  short lines
- **Language comes from the matched headings** (claims heading wins); stopword scoring runs
  only when no heading matched
- **Word auto-numbered claims are reconstructed**: `docSplit.ts` synthesizes `N. ` for
  `<w:numPr>` paragraphs (single-level decimal; deeper levels are flagged as
  `unusualNumbering`, not guessed) and records the prefix so export strips it again.
  Without this, claim segmentation, numbering, dependencies and antecedent basis all go
  silently dead
- Headers/footers/comments/footnotes are separate ZIP parts (excluded for free); text boxes
  are skipped explicitly; tracked insertions kept, deletions dropped
- **The reader and the writer are mirrors**: `<w:br/>`, `<w:tab/>`, `<w:noBreakHyphen/>`,
  `<w:softHyphen/>` ↔ `\n`, `\t`, U+2011, U+00AD. Add an element to one side and the other
  needs it too (dropping the hyphens once glued `cross‑section` together and deleted the
  hyphen on export)
- **Export writes back into the original file**: only changed paragraphs are rewritten
  (line diff); everything else and every other ZIP part stays byte-identical. A rewritten
  paragraph collapses to one run with the first run's `<w:rPr>` (formatting lost in edited
  paragraphs only — the button's tooltip says so). With no imported source a fresh minimal
  `.docx` is generated
- **Claim alignment** (each was a real defect): an inserted line becomes its own `<w:p>`,
  never a `<w:br/>`; `alignLines` never pairs a blank line with a real one; a new
  paragraph is cloned from the nearest paragraph WITH text (`templateNear`) and appends
  land after the last visible paragraph; on an auto-numbered list ANY leading claim number
  is stripped (an insertion renumbers the ones below). Clones drop `w14:paraId`/`textId`
  and, when blank, `<w:numPr>`
- **Numbering style is preserved**: list in → list out, typed in → typed out, nothing
  imported → typed. `conformClaim` makes every claim line match how the section numbers
  claims; only lines opening with a claim number are conformed (a `What is claimed is:`
  lead-in stays out of the list). Opt-in per buffer (`planEdits(…, {claims: true})`) —
  a description line starting `1.` is prose. `ilvl > 0` is left alone
- **The reference list is written back only when unambiguous.** `refListWritable` refuses
  `noSection`, `ambiguous` (the list's paragraphs are also in the description buffer) and
  `table` (cells are separate paragraphs; diffing would move values between cells). The
  other buffers still export and the banner names the reason
- Overwriting non-empty buffers asks first; a dismissible banner reports what was detected
  with a one-step **Undo**. Banner messages are i18n KEYS resolved at render time (the
  import may have just changed the language)
- `imported` (bytes + provenance) is deliberately not persisted; a refresh keeps the text
  but drops round-trip export

#### Three guards on "exactly those changes and no others"

1. **Buffers are disjoint by construction** (`docSplit.ts`): each section is clipped at
   every other LOCATED section's heading. Without it an amendment sheet (claims before
   description) gave both buffers the same paragraphs and export wrote two texts over one
   range. Clipping only at located sections is deliberate — clipping at every heading of a
   kind would truncate a German description at its own `Ausführungsbeispiel 2`
2. **`orderSplices` refuses a splice set it cannot apply safely** (`docx/write.ts`).
   Splices apply back-to-front; at one offset an insertion and a replacement can meet, and
   applying the insertion first mangled the XML. Replacement goes first; anything still
   overlapping throws `DocxError('spliceOverlap')`. The comparator is a subtraction, not
   `? -1 : 1`
3. **The written file is read back and compared** (`docx/verify.ts`), tolerating exactly
   two deliberate differences: trimmed blank edges, and claim numbers when the claims are a
   Word list. The file is still delivered on failure, with a banner naming the first
   differing line

Plus `docx/xmlText.ts`, the only producer of `<w:t>` content: pasted PDF text carries form
feeds, C0 controls and unpaired surrogates that XML 1.0 cannot hold; they are dropped (and
CR, which a parser would turn into a line break). Re-importing does not prove
well-formedness — use `xmlFault` in tests.

Known `.docx` limitations (visible, not silent): formatting lost in edited paragraphs; a
buffer with no section in the source cannot be written back; `.docm` exports under `.docx`
with macro content types; `<w:sym>` and field results are not read; a section break in a
deleted paragraph goes with it; table paragraphs import as flat lines.

### Reference-list check (reconciliation)

- The left pane takes the draft's own list (pasted, or auto-filled by import) and diffs it
  against the active buffer's signs — description when there is one, else claims. Reports
  **listed but never used**, **used but never listed**, **term mismatch** and a sign
  **listed twice**. Terms compare on stems
- `parseRefList` is liberal about the separator (`10 housing`, `12 - cover`, `14\tshaft`,
  `16: seal`, `18) flange`) and strict about one thing: the line must START with a sign
- The list is also **read into the extraction**: its multi-word terms apply to both buffers
  (see Multi-word Terms). The panel says so with an `ⓘ` note (information, not a finding)
- Persisted under `rsc_reflist`; cleared by Reset all; restored by import Undo. On a large
  document (>5000 chars) the list input is debounced with the buffers, and the index keeps
  its identity while its parsed content (`sig`) is unchanged, so typing in the box does not
  invalidate both extraction memos

### Claim-set statistics (claims mode)

- Total / independent / dependent / longest chain, **multiple dependency** (an EPO fee) and
  claims depending on a multiply-dependent claim; DPMA from the 11th claim, EPO from the
  16th and again from the 51st (the two EPO bands are exclusive; the two offices are
  reported independently). No USPTO thresholds — a test asserts none are emitted
- `THRESHOLDS` are counts, not currency. A range (`claims 1 to 4`) is ONE multiply-dependent
  claim. **Nothing here is an error** — rendered as `ⓘ`/`--info`, never the warning triangle

### Keyboard

- Chosen for a **German layout**: `Ctrl`/`Cmd`+`↓`/`↑` step through errors (Up/Down, not
  Left/Right — `Ctrl`+`←`/`→` is word movement in a textarea), `Ctrl`+`Shift`+`↓`/`↑` step
  within the **same term** (bucket = `errorGroup`: the term stem, or the category for
  term-less errors; a single-error term stays put; measured from the arrows' cursor unless
  a card click moved the focus — `anchorIdx`), `Ctrl`+`F` finds text, `Ctrl`+`Shift`+`F`
  focuses the sidebar filter, `Ctrl`+`M` mode, `Ctrl`+`B` / `Ctrl`+`Shift`+`B` fold the
  panes, `Ctrl`+`O` import, `Ctrl`+`S` export, `Ctrl`+`?` help (`?` reports `e.key === '?'`
  on both layouts), `Escape` closes the find bar / context menu. `Ctrl`+`[`/`]` still work,
  undocumented
- **Every binding takes a modifier**: `useHotkeys` suppresses unmodified keys while typing,
  and the editor holds focus nearly always. A bare `/` was removed for that reason
- The help screen (`?` button, lazy chunk preloaded on hover/focus) is the app's **only
  focus trap**; it restores focus to its opener, as `CtxMenu` does
- Cards are keyboard-reachable via `activatable()` (`role="button"`, `tabIndex`, Enter/Space)
  because they contain a nested dismiss button and cannot be `<button>`s. The handler fires
  only when `e.target === e.currentTarget`, so a nested button keeps its own activation

### Find in text (Ctrl+F)

- Searches the **draft**, not the findings (that is the sidebar filter). Literal,
  case-insensitive, via a regex with the `i` flag over the ORIGINAL string — `toLowerCase`
  is not length-preserving (U+0130), so offsets off a lowered copy can be wrong
- Capped at `MAX_MATCHES` (5000); the counter shows `+` at the cap
- Matches **win over the error marks they overlap** (`buildHtml` merges them in a separate
  pass), stepping keeps focus in the search box (`scrollTo(…, focus=false)`), the search
  starts **from the caret** and wraps, and matches are computed against the **debounced**
  buffer (the same string the marks are placed in). Editing with the bar open re-highlights
  but does not re-jump

### Reference numeral list

- A collapsed-by-default Section in the left pane: `sign → term → count`, with a Copy
  button (tab-separated) beside the header. Dominant term = most frequent, tie-broken by
  width, then first appearance — but a cumulative back-reference never competes (see
  Cumulative References)

### Error categories (`logic/errorKinds.ts`)

The four non-sign categories — article, missing sign, claim numbering, claim dependency —
are rows of one table. A row reaches its records (`items: (res) => res.artErrors`), gives
its dismissal key, span, term (or null), highlight class, search predicate and the
presentation data (glyph, colour token, i18n keys, message formatter). `errorSpans`,
`buildHtml`, `App`, `Sidebar`, `StatusBar` and `ErrorCard` loop the table.

**Adding a category**: produce it in `extract.ts`, add a row, add the i18n keys, define
`--<color>` / `--<color>-bg` in both themes, and list the field in `EMPTY_RESULT`
(`App.tsx`, spelled out and annotated so the compiler catches an omission).

Three things must not be "simplified" (guarded by `errorKinds.test.ts`):

1. **The dismissal prefixes are a storage format** (`s:` `a:` `b:` `n:` `d:` in users'
   `localStorage` under `rsc_dis`). They stay literal in `disKey`; never derive them from `id`
2. **`focus.key` is not uniform**: the sign string for a sign, a character offset otherwise.
   `focusCycle`, `anchorIdx` and each card's `focused` comparison depend on it
3. **`navProp`** (`ae`/`bt`/`ne`/`de`) is the property `getAllErrors` carries the raw record
   under; the tests read it by name

**Signs are deliberately not a row** (severity, several occurrences, term chips, their own
card), and `ctxMenuItems.ts` stays per-category for the same reason.

### Error management

- Click a card to jump to its occurrence; clicking the same card again cycles to the next
  (document order), and the click after the last clears the focus (`focusCycle`, keyed by
  the `focusOcc` cursor). A **term chip** on a sign card cycles only the occurrences written
  with THAT term, selecting term + sign ("shaft 22"); `Focus` carries an optional `term` and
  `sameFocus` decides advance vs restart. `onFocusSign(sign, term?)` is the one callback
- Hover a sign in the editor to highlight its card and vice versa; dismiss individually or
  all; the status bar steps through errors
- **Right-click menu** acts on a sign, an article or a bare term at the caret. Sign:
  extend/reduce term, **correct a mistyped sign** (`suggestSign`; frequency decides, the
  count is in the label, refused on an even split or a tie; only the sign's characters are
  replaced), dismiss. Bare term: extend/reduce, **insert the missing sign** (` 10` or
  ` (10)` in claims mode, offered only when the term has exactly one sign), dismiss.
  Article: dismiss. Both edits re-check the span against the live buffer before splicing
  (the spans come from the debounced extraction) and leave the caret after the edit
- **Reset all** (fixed bottom-right, behind a confirm) clears overrides, dismissals, both
  buffers, the reference list and the imported document

### Multi-word terms

A term is the base noun in front of a sign unless something widens it:

- **The drafter's reference list** (`listTerms.ts`): `30 control unit` states the term is two
  words. The match is on the **whole phrase** (a list holding `control unit` does not widen
  "the drive unit 40"); the longest listed phrase wins; stems compare; the index is keyed
  on the **last two words** so a list naming three hundred "… element"s stays O(1)
- **The ordinal pattern** ("first bearing" / "second bearing") — `detectOrdStems` learns the
  base noun from one modified occurrence and widens every later modified occurrence
- **A manual override** via Extend/Reduce term (`rsc_mwo`), an absolute width from the term
  as displayed. It **wins outright over both automatic sources, including an explicit 0**
  (deleting the key at width 1 handed the term straight back to the list). The two automatic
  sources take the wider

Words consumed by a multi-word term are not bare-term errors; a bare occurrence of a
widened term is reported as the whole phrase. The `2w` badge comes from the recorded term.

#### The modifier vocabulary (`EN_ORD` / `DE_ORD`)

`isOrd` matches the raw lowercased word against this table; any of them directly in front
of the base noun widens the term. **Numberings and qualifiers behave identically** (a
split, with only numberings droppable, cost a table and bought nothing). German is generated
as stem × the five adjective endings `-e -en -er -es -em`, because hand-listing is how
`oberer`/`oberes`/`oberem` once went missing — and a missing inflection silently drops the
term back to its base noun.

|        | **Numberings**                                                                                            | **Qualifiers**                                                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EN** | `first` `second` `third` `fourth` `fifth` `sixth` `seventh` `eighth` `ninth` `tenth` `eleventh` `twelfth` | `further` `other` `another` `next` `upper` `lower` `inner` `outer` `front` `rear` `left` `right` `top` `bottom` `primary` `secondary` `main` `auxiliary` `additional` |
| **DE** | `erst` `zweit` `dritt` `viert` `fünft` `sechst` `siebt` `siebent` `acht` `neunt` `zehnt` `elft` `zwölft`  | `weiter` `zusätzlich` `primär` `sekundär` `ober` `unter` `inner` `äußer` `vorder` `hinter` `link` `recht` `ander`                                                     |

`constants.test.ts` pins the sets against this table in both directions. **A modifier may
also be an excluded word**: `EXCL` bars a word from being the **base noun** only, so
`a further 200 rivets` registers no term while `a further shaft 20` is `further shaft`
(`collectTermToks` ends on an excluded word unless it is a modifier and the base noun is in
hand). What catches a real slip is the **one-candidate rule** below: a CHANGED modifier is
two widened terms under one sign; only a DROPPED one is forgiven.

### Cumulative references (`logic/cumulative.ts`)

```
Die Vorrichtung umfasst eine erste Welle 10, eine zweite Welle 20 und eine dritte Welle 30.
Die Wellen 10, 20 und 30 sind koaxial zueinander angeordnet.
```

Read literally the second line is three errors; all are artefacts of a correct draft. The
rule folds the shortened occurrence into the widened term it refers back to when ALL of:

- **Same sign** — the identity; no proximity/plural/list heuristic on top
- **Exactly the modifier dropped** — the widened stem minus its first word, stem for stem
- **The dropped word is a modifier** (`isOrd`), not any first word — a list-declared
  `control unit` written as "the unit 30" is a departure, not a shorthand
- **One candidate** — a sign carrying both `erste Welle` and `zweite Welle` is the
  inconsistency the tool exists to report, so nothing folds

The folded occurrence is still counted and still needs parentheses in claims mode; it loses
its own term entry and stays out of the raw spellings (so the list prints the widened
form), the article check and that check's evidence positions (a German plural
back-reference takes "die" whatever the gender). A sign-less "die Wellen" is then not a
missing-sign finding. A manual reduction removes the widened form and the real conflict
is reported.

### Article checking

- **Description**: first use (by document position) must take an indefinite article, later
  uses a definite one
- **Claims (antecedent basis)**: "introduced" is per claim chain — earlier in the same
  claim, anywhere in an ancestor claim (transitive, ranges and "preceding claims" included),
  or before the first claim. A second independent claim may say "a device" again; "the
  seal" in a chain that never introduced one is flagged
- German der/die/das gender consistency applies in both modes

### Sign detection

- `SIGN_RE` (1–5 digits, optional trailing letter, optional prime — `10` and `10'` are
  distinct) and `ROMAN_RE` (UPPERCASE Roman step 1–3999 plus `I.1` substeps; `mm`/`cm` and
  `In`/`Die` never match). `isSignToken` branches on the first character (it is the hottest
  predicate — three passes per extraction)
- **Bracketed paragraph numbers** (`[0012]`, `[18, 20]`) are never signs and do not satisfy a
  bare term. **Cross-reference words** (`figure`, `claim`, `Figur`, `Anspruch`, …) are in
  `EXCL`, as are the range connectors `to`/`bis`
- **Ranges/lists** register every literally listed sign under the shared preceding term:
  `18 to 22`, `18 bis 22`, `18–22`, `18, 20 and 22` / `6, 12; 13`, EN + DE. The
  digit-connector-digit adjacency keeps `a housing 12 and a cover 14` apart. Endpoints only.
  `CONNECTOR_ALT`/`RANGE_DASHES` are shared with the claim-reference parser — do not
  re-declare them
- **Parenthesised groups**: a `(…)` whose interior is only signs counts as parentheses for
  every sign inside; `(see 10)` does not qualify
- Signs with no preceding term go to `noTermSigns` (used by cross-ref only)
- Not handled: letter-prefix signs (`A10`); a date's trailing list (`January 3, 2020`
  registers `2020`); a sign glued to a word (`housing12`); an UPPERCASE abbreviation that
  is a valid numeral (`MM`, `DIV`) directly after a term word

### Layout, fonts, theme

- Three columns: reference list | editor | reference signs. Only the editor is fluid; both
  side panes collapse to a 34px rail (persisted in `rsc_panes`) — **collapsing is CSS, not
  unmounting**, so the mobile tab bar (≤860px, one pane at a time) and the desktop chevron
  cannot disagree; 861–1100px narrows the panes first. Both panes are named `complementary`
  landmarks. The left pane renders even with an empty document
- **No web fonts.** `--font-ui` (proportional) and `--font-mono` (the editor) are system
  stacks; six `.woff2` files were 54% of the critical path. The two are not interchangeable:
  the textarea and the backdrop must share `--font-mono` or highlights slide off the text
- Themes: light / dark / system (`rsc_theme`, applied to `<html data-theme>`; the inline
  script in `index.html` sets it before the app mounts). **Both palettes clear WCAG AA on
  every surface** (`palette.test.ts` also pins `text > text-muted > text-dim`, `--on-accent`
  on `--accent`, and scans the stylesheet: no partial `opacity` on text, no literal colours)
- `--info` marks informational content (claim-set panel, list note); `--find` is a hue no
  error category uses
- Section headers (`.sec-lbl`) are real buttons reset to read as uppercase labels; the
  `Section` component is the one implementation for both panes

### Persistence and the editor's two layers

- Buffers, language, mode, dismissals, overrides, list and panes persist (see the key
  table); everything goes through `usePersistentState`. The two buffers debounce their
  writes (400 ms — an undebounced write serialised 200 KB per keystroke) and flush on
  pagehide/visibilitychange; a quota failure shows the storage-full banner instead of
  silently losing work
- Extraction is debounced (200 ms) for documents ≥5000 chars, and the **first extraction of
  a restored buffer is deferred past first paint** (`useDebounced`'s `initial`): 4199 ms →
  227 ms to first render at 4× CPU throttle with two 112 KB buffers
- The textarea and the highlight backdrop are two scroll-synced layers built from the same
  debounced buffer. `buildHtml` appends a trailing-newline sentinel so both share one
  `scrollHeight`; `useEditorSync` re-mirrors the scroll after the backdrop commits (a large
  paste scrolls the textarea before the taller backdrop exists), but only once the editor
  has ever scrolled — reading the geometry at mount forced the whole first layout inside the
  mount task (46 of 78 ms)
- **Jumps land mid-editor, measured**: a `Range` over the backdrop (`spanBox`) gives the
  real position (a wrapped patent paragraph made the old newline-count estimate land a
  screenful off); `centerOffset` centres and clamps; the estimate survives as the fallback
  when there is no layout
- **Elastic overscroll**: `overscroll-behavior: none` on both layers (load-bearing, a test
  asserts it), and `backdropScroll` applies any residual overshoot as a `translateY`

### Offline support

- **The shell is precached at install** (`cache.addAll` over the list `swPrecache.ts`
  injects); a worker that only fills opportunistically is empty after the first visit
- **Lookups pass `ignoreVary`**: static hosts send `Vary: Origin`, module requests are CORS,
  and every precached entry was rejected — findable only in a real browser; do not remove
- **The cache name carries a build id**, so `activate` actually evicts the previous deploy;
  an unchanged hashed chunk is copied across from the old cache rather than refetched
  (hashed URLs only; navigation/manifest/icon are always refetched). Non-2xx rejects the
  whole install (`build/swInstall.test.ts` runs the shipped worker against a fake
  CacheStorage)
- Navigations and unhashed assets are network-first with a cached fallback; everything else
  cache-first. The lazy chunks (`.docx`, bee, help) are precached, which is the rule that
  makes deferring anything safe here
- Verified in Chromium: first visit precaches; offline hard reload boots, extracts, and a
  first-ever `.docx` export works

### The bee

- Two triggers: a rare random draw (Bernoulli per 10 s tick, mean 5 min — memoryless) and
  typing **bee** (or **Biene(n)** in German) — fires when the **count rises** in the
  **debounced** text, so a restored buffer or `beetle`/`Bienenstock` summon nothing; a
  language switch re-baselines. Up to `MAX_BEES` (5). `prefers-reduced-motion` suppresses
  only the random appearances
- `beeFlight.ts` is the pure motion model (jittery, hover ~25% of waypoints). `Bee` writes
  transforms straight to the DOM in a rAF loop (a 60 fps `setState` re-rendered the app),
  holds `onDone` in a ref with `[]` deps, and is `pointer-events:none` (hover bubble is
  geometric). Lazy chunk; `countBees` lives apart so nothing eager imports the model

## Data flow

```
textarea (per-mode buffer)                reference list (pasted or imported)
   │ debounced ≥5000 chars                     │
   ▼                                           ▼
tokenize() ─▶ extractData(text, lang, mwo, autoMW, isClaims, listTermIndex())
                 │  {signData, termData, artErrors, bareTerms, numErrors, depErrors,
                 │   noTermSigns, claimGraph}   (claims mode: computeClaimGraph inside)
                 ├─▶ classify()          per-sign 'warn' | 'ok'
                 ├─▶ getAllErrors()      status-bar navigation (via eachErrorSpan)
                 ├─▶ buildHtml()         backdrop marks (via eachErrorSpan) + find matches
                 ├─▶ computeCrossRef()   both results (App memoizes each buffer's)
                 ├─▶ reconcileRefList()  list vs the description (or claims) result
                 └─▶ claimStats()        the claims result's graph
```

## localStorage keys

| Key           | Purpose                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `rsc_theme`   | `'light'` / `'dark'` / `'system'`                                      |
| `rsc_lang`    | `'en'` / `'de'`                                                        |
| `rsc_mode`    | `'description'` / `'claims'`                                           |
| `rsc_desc`    | Description buffer (debounced write)                                   |
| `rsc_claims`  | Claims buffer (debounced write)                                        |
| `rsc_reflist` | The drafter's reference-sign list                                      |
| `rsc_dis`     | Dismissed-error keys (JSON array; see `disKey`)                        |
| `rsc_mwo`     | Manual multi-word overrides (base stem → extra words; explicit 0 wins) |
| `rsc_panes`   | Which side panes are open                                              |

## Payload

`npm run budget` (CI, after the build) measures gzipped transfer: **critical path 41.8 KB /
50 KB** (index.html with inline CSS 5.6, entry chunk 29.4, vendor 7.5), **whole precached
shell 60.0 KB / 70 KB**. Ceilings, not targets.

What moves the critical path and what does not — all measured, do not re-spend the effort:

- Done: no web fonts (−95.8 KB), stylesheet inlined, Preact via compat (45 → 7.5 KB),
  framework/app split so the vendor chunk carries over between deploys, lazy `.docx` / bee
  / help chunks, terser with three passes (−1.1 KB; `mangle` names-only — property
  mangling would break the i18n keys and the `ERROR_KINDS` accessors), HTML comments
  stripped from `index.html` (−0.5 KB — the one file that is not minified), dead i18n keys
  and duplicate component/logic code removed (−0.4 KB)
- Zero or negative, because gzip already collapses repetition and indirection replaces
  compressible text with novel tokens: merging duplicated CSS selectors (10 bytes),
  folding repeated JSX into a component (10 bytes), `mark.h-*` as one rule + tokens
  (−30 bytes, worse), bare preact without compat (90 bytes worse), i18n key dedup
  (~0.2 KB at most; deleting the ENTIRE German table buys 2.24 KB). Refactor duplication
  for maintainability, not bytes
- Per-module attribution: build with `--sourcemap` and map generated bytes to sources
  (i18n.ts is ~17% of the entry chunk; App.tsx, extract.ts, useEditorSync.ts, stem.ts,
  constants.ts, Sidebar.tsx follow)

## Development

```bash
npm install        # first-time setup
npm run dev        # dev server with hot reload
npm test           # Vitest
npm run typecheck  # tsc over src/, build/ and the service worker (3 projects)
npm run format     # prettier --write . (CI runs format:check first)
npm run build      # production bundle → dist/
npm run budget     # payload budget over dist/
npm run preview    # serve the production build
```

Native ES modules: run through the dev/preview server, not from disk.

- **Deployment**: `.github/workflows/deploy.yml` runs format:check, typecheck, tests, build
  and budget on every push/PR, and publishes `dist/` to Pages from `main`
  (`workflow_dispatch` deploys too, so a dropped Pages deployment can be retried)
- **Dependencies**: `preact` (+ `preact/compat`), `fflate` (the `.docx` ZIP, ~5 KB gzipped
  in the lazy chunk). Dev: Vite + `@preact/preset-vite`, terser, TypeScript (checker only —
  nothing emits from it; Node strips the types in `build/*.ts` itself, hence
  `erasableSyntaxOnly`), Vitest + jsdom + `@testing-library/preact` + user-event + jest-dom,
  `preact-render-to-string` (the smoke test, and what `react-dom/server` resolves to)

## Testing

`npm test` runs **818 tests** in ~13 s. Logic tests run under `node`; only `*.ui.test.tsx`
runs under `jsdom` (`environmentMatchGlobs` in `vite.config.ts`; `src/test/setup.ts` adds
jest-dom and `matchMedia`/`clipboard` stubs). `build/` is included, so the plugins are
tested too.

Everything is TypeScript. Three projects, all run by `npm run typecheck`:

| Project              | Covers                        | Notes                                                  |
| -------------------- | ----------------------------- | ------------------------------------------------------ |
| `tsconfig.json`      | `src/`, `build/`, vite config | `strict` + `noUncheckedIndexedAccess`                  |
| `tsconfig.test.json` | the test suite                | the same, `noUncheckedIndexedAccess` off (see below)   |
| `tsconfig.sw.json`   | `src/sw.ts` alone             | `lib: WebWorker` in place of DOM; the two cannot share |

- **`noUncheckedIndexedAccess` is the flag this codebase needs** (map lookups and regex
  captures everywhere; it found real latent faults). It is **off for tests deliberately**:
  `expect(res.signData['12'].count)` is an assertion about the fixture, and a guard there
  invites `?.` chains that let a broken fixture pass. Map types carry no redundant
  `| undefined`. `src/test/helpers.ts` provides `must()`, `q()`, `maybe()`
- **A union member whose discriminant is itself a union of literals is never narrowed
  away** — hence `SignSpan` and `SignTermSpan` are separate members. A boolean discriminant
  does narrow. `docs/typescript-migration.md` has the details
- Formatting is enforced (`.prettierrc`, `format:check` in CI)

Coverage by area (what each file pins that is easy to break):

| File                                                                                                                                                                 | Pins                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenize.test.ts`                                                                                                                                                   | spans, `12a` / `10'` / `10′`, Roman steps + word fall-through (`In`, `Die`), German letters, CRLF, repeat-call safety                                                                                                                                                                                                                                                                                                                               |
| `stem.test.ts`                                                                                                                                                       | Porter/Snowball steps, dispatch, cache transparency across eviction and per-language isolation                                                                                                                                                                                                                                                                                                                                                      |
| `constants.test.ts`                                                                                                                                                  | `isClaimNumber` (Roman `I.` guard, CRLF), `isSignToken`, `romanToInt`/`signVal`, `compareSigns` grouping, the modifier vocabulary (two-way pin against the table above, all five DE inflections spelled out, no modifier in `EXCL` as a base-noun blocker), `disKey`                                                                                                                                                                                |
| `extract.test.ts`                                                                                                                                                    | consistency/inconsistency, case-folded terms vs case-sensitive signs, parentheses, numbering keys, EN/DE articles + gender, ordinal widening + `mwo`, every DE qualifier inflection, excluded-word-as-modifier, bare terms, primes, Roman signs, ranges/lists (EN+DE, negatives), groups, `noTermSigns`, `[0012]`, antecedent basis, dependency errors, list-derived multi-word terms, cumulative references and every case that must stay an error |
| `claims.test.ts`                                                                                                                                                     | segmentation, refs (lists, ranges, DE, "preceding"), graph (transitive ancestors, error types, duplicate keys, acyclicity, full closure on a diamond)                                                                                                                                                                                                                                                                                               |
| `cumulative.test.ts`                                                                                                                                                 | what folds, and — the half that matters — what refuses to (across signs, changed modifier, non-modifier first word, two modifiers, lost more than the modifier, different noun, wrong language)                                                                                                                                                                                                                                                     |
| `crossref.test.ts`, `reflist.test.ts`, `reconcile.test.ts`, `listTerms.test.ts`, `claimStats.test.ts`, `signFix.test.ts`, `findText.test.ts`, `ctxMenuItems.test.ts` | each module's contract, including the numbered-form-wins list entry, the 300-entry list shape, no USPTO threshold, the refused sign corrections, the `MAX_MATCHES` cap and the length-shifting lowercase case                                                                                                                                                                                                                                       |
| `errorKinds.test.ts`                                                                                                                                                 | unique ids, the historical dismissal prefixes, `navProp` names, well-formed spans, i18n keys that exist, both colour tokens in both themes, `sameFocus`                                                                                                                                                                                                                                                                                             |
| `errorSpans.test.ts`                                                                                                                                                 | severity, `signTerm` spans, dismissed signs kept for the backdrop but dropped by the navigator, `term`/`errorGroup`, cumulative back-references, and that every emitted highlight class exists in `styles.css`                                                                                                                                                                                                                                      |
| `buildHtml.test.ts`                                                                                                                                                  | marks, `h-dis`, focus, escaping, non-overlap, **strip-marks ≡ escapeMarkup(text) + sentinel**, `findAtPos`, find matches over every category                                                                                                                                                                                                                                                                                                        |
| `scrollSync.test.ts`                                                                                                                                                 | `backdropScroll`, `centerOffset`, and that `overscroll-behavior: none` is still in the stylesheet                                                                                                                                                                                                                                                                                                                                                   |
| `headings.test.ts`, `docSplit.test.ts`, `detectLang.test.ts`, `importDoc.test.ts`                                                                                    | heading normalisation and negatives, EN/DE slicing, exclusions, auto-number synthesis, `signList`, **disjoint ranges**, the `Ausführungsbeispiel 2` subheading, language from headings, round-trip vs fresh export                                                                                                                                                                                                                                  |
| `docx/read.test.ts`, `write.test.ts`, `lineDiff.test.ts`, `claimNumbering.test.ts`, `xmlText.test.ts`, `verify.test.ts`, `integrity.test.ts`                         | the reader/writer mirror, byte-identical untouched parts, claim alignment and numbering style, LCS bail-out, forbidden characters, verification in both directions, **the insertion/replacement collision**, `orderSplices` refusals                                                                                                                                                                                                                |
| `palette.test.ts`                                                                                                                                                    | AA contrast of every token on every surface in both themes, ramp ordering, the stylesheet scans                                                                                                                                                                                                                                                                                                                                                     |
| `beeFlight.test.ts`, `i18n.test.ts`, `swPrecache.test.ts`, `swInstall.test.ts`, `inlineCss.test.ts`, `budget.test.ts`                                                | the flight model, EN/DE key parity, the precache list and build id, the shipped install handler, stylesheet inlining + HTML comment stripping, the budget arithmetic                                                                                                                                                                                                                                                                                |
| `use*.ui.test.tsx`                                                                                                                                                   | debouncing and the deferred first render; persistence (debounce, flush, quota, codecs); hotkeys; file drop counting; that `useEditorSync` reads no geometry at mount                                                                                                                                                                                                                                                                                |
| `App.ui.test.tsx`                                                                                                                                                    | the app end to end in jsdom: cards, dismissal, cycling and term chips, the reference list copy, `.docx` import/undo/export, the context menu (extend, insert sign, fix sign), find bar, keyboard navigation, panes, landmarks, reference-list check, claim statistics, the bee                                                                                                                                                                      |

Manual smoke test — `npm run dev`, paste into Description mode:

```
The device 10 comprises a housing 12 and a cover 14.
The housing 12 is made of aluminium.
The cover 14 is secured to the housing 12 by screws 18.
```

Signs 10, 12, 14, 18 appear as "Consistent". Adding `The housing 12 is connected to the
casing 12.` flags sign 12 with both "housing" and "casing".

## Working notes for the next agent

- Keep `logic/` free of DOM and of fflate; keep the reader/writer mirror; keep `disKey`
  literal; keep `EMPTY_RESULT` spelled out; keep both stacks in `styles.css` system fonts
- Anything deferred to a lazy chunk must stay in the precache list (automatic) AND in
  `build/budget.ts`'s `LAZY` (manual), or the win reports as a loss
- Before claiming a payload win, build with `--sourcemap`, attribute bytes per module, and
  compare gzipped sizes against a saved baseline `dist/`. Screenshot before/after with the
  Chromium in `/opt/pw-browsers` for CSS changes
- Update the test count and the budget figures here when they change
