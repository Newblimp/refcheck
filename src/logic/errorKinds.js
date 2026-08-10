import { disKey } from './constants.js';

// ── ERROR KINDS ──────────────────────────────────────────────────────────────
//
// One row per error category, and the single place that knows a category
// exists. Before this table the four categories were hand-written parallel code
// in nine files: extract.js produced them, errorSpans.js visited them,
// buildHtml.js named their highlight class, App.jsx filtered/dismissed/counted
// them, Sidebar.jsx rendered them, four near-identical card components displayed
// them, i18n.js labelled them and styles.css coloured them. Adding a fifth meant
// finding all nine.
//
// errorSpans.js already unified the two *logic* consumers (buildHtml and
// getAllErrors). This finishes the job on the UI side.
//
// The rows carry UI data (a glyph, a colour token name, i18n KEYS) as well as
// logic. That is deliberate: they are plain strings and pure functions, so this
// module is still framework-free and still runs under the node test env — and
// splitting them into a second table in components/ would recreate exactly the
// two-places-to-edit problem the table exists to remove. Nothing here imports
// React or i18n; `message` takes the resolved `t` as an argument.
//
// ── What must NOT be "simplified" ────────────────────────────────────────────
//
// 1. The dismissal prefixes stay literal in `disKey` (constants.js) and are
//    referenced here by name. They are a STORAGE FORMAT: 's:' 'a:' 'b:' 'n:'
//    'd:' sit in users' localStorage under `rsc_dis`. They happen to be first
//    letters, so deriving them from `id` would work today and silently discard
//    every stored dismissal the first time a category is added whose initial
//    collides with an existing one.
// 2. `navProp` is the property name getAllErrors carries the raw record under
//    ('ae', 'bt', 'ne', 'de'). App.jsx and the tests read those by name.
// 3. Only these four kinds live here. Signs are NOT a row: they carry a
//    severity, several occurrences, a term-conflict story and their own card, so
//    every consumer special-cases them anyway. Forcing them into the table would
//    mean a row whose fields are mostly unused and consumers that still branch.

/**
 * @typedef {Object} ErrorKind
 * @property {string} id          Category id, also `type` in getAllErrors output
 * @property {string} field       Where extractData puts the array
 * @property {(e: any) => string} disId    Dismissal identity within the category
 * @property {(e: any) => string} disKey   Full dismissal key (prefix + identity)
 * @property {(e: any) => number} start    Char span of the highlight
 * @property {(e: any) => number} end
 * @property {(e: any) => string|null} term  Stemmed term, or null if it has none
 * @property {(e: any) => string|number} cardKey  React key for the card
 * @property {string} hl          Highlight class in styles.css
 * @property {string} navProp     Historical property name in getAllErrors output
 * @property {(e: any, q: string, termData: object) => boolean} matches  Search
 * @property {string} icon        Glyph for the sidebar section header
 * @property {string} color       CSS token base: `var(--<color>)`, `--<color>-bg`
 * @property {string} sectionLbl  i18n key for the section header
 * @property {string} chipLbl     i18n key for the status-bar chip
 * @property {(e: any) => string} badge  Card badge content
 * @property {((e: any) => string)|null} sub  Card's second line, if any
 * @property {(e: any, t: object) => string} message  Card's main line
 */

/** @type {ErrorKind[]} */
export const ERROR_KINDS = [
  {
    id: 'art',
    field: 'artErrors',
    disId: (e) => e.termStem,
    disKey: (e) => disKey.art(e.termStem),
    start: (e) => e.artStart,
    end: (e) => e.artEnd,
    term: (e) => e.termStem,
    cardKey: (e) => e.artStart,
    hl: 'h-art',
    navProp: 'ae',
    matches: (e, q, termData) =>
      e.termStem.includes(q) ||
      [...(termData[e.termStem]?.rawTerms || [])].some((r) => r.includes(q)),
    icon: '◈',
    color: 'art',
    sectionLbl: 'gArt',
    chipLbl: 'artLbl',
    // The article itself, rather than a glyph — it is the thing being judged.
    badge: (e) => e.article,
    sub: (e) => `${e.sign} · ${e.termStem}`,
    message: (e, t) =>
      e.errType === 'first-def'
        ? t.artFD(e.article)
        : e.errType === 'repeat-indef'
          ? t.artRI(e.article)
          : t.artGender(e.article, e.prevArt),
  },
  {
    id: 'bare',
    field: 'bareTerms',
    disId: (e) => e.termStem,
    disKey: (e) => disKey.bare(e.termStem),
    start: (e) => e.termStart,
    end: (e) => e.termEnd,
    term: (e) => e.termStem,
    cardKey: (e) => e.termStart,
    hl: 'h-bare',
    navProp: 'bt',
    matches: (e, q) => e.term.includes(q) || e.termStem.includes(q),
    icon: '∅',
    color: 'bare',
    sectionLbl: 'gBare',
    chipLbl: 'bareLbl',
    badge: () => '∅',
    sub: null,
    message: (e, t) => t.bareTerm(e.term, e.signs),
  },
  {
    id: 'num',
    field: 'numErrors',
    disId: (e) => e.key,
    disKey: (e) => disKey.num(e.key),
    start: (e) => e.start,
    end: (e) => e.end,
    // Claim numbering names no term; it groups by category for the same-term
    // jump instead (see errorGroup).
    term: () => null,
    // The edit-stable key, so React keeps the card across an edit elsewhere.
    cardKey: (e) => e.key,
    hl: 'h-num',
    navProp: 'ne',
    matches: (e, q) => String(e.value).includes(q) || String(e.expected).includes(q),
    icon: '⌗',
    color: 'num',
    sectionLbl: 'numberingLbl',
    chipLbl: 'numberingLbl',
    badge: () => '⌗',
    sub: null,
    message: (e, t) => t.numberingErr(e.value, e.expected),
  },
  {
    id: 'dep',
    field: 'depErrors',
    disId: (e) => e.key,
    disKey: (e) => disKey.dep(e.key),
    start: (e) => e.start,
    end: (e) => e.end,
    term: () => null,
    cardKey: (e) => e.key,
    hl: 'h-dep',
    navProp: 'de',
    matches: (e, q) => String(e.claim).includes(q) || String(e.ref).includes(q),
    icon: '↷',
    color: 'dep',
    sectionLbl: 'gDep',
    chipLbl: 'depLbl',
    badge: () => '↷',
    sub: null,
    message: (e, t) =>
      e.type === 'missing'
        ? t.depMissing(e.claim, e.ref)
        : e.type === 'self'
          ? t.depSelf(e.claim)
          : t.depForward(e.claim, e.ref),
  },
];

/** Rows by id, for the consumers that hold an id rather than a row. */
export const KIND_BY_ID = Object.fromEntries(ERROR_KINDS.map((k) => [k.id, k]));

/** The records of one kind in an extraction result (never undefined). */
export const kindItems = (res, kind) => res?.[kind.field] || [];
