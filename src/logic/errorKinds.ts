import { disKey } from './constants.ts';
import type { DepError } from './claims.ts';
import type { ArtError, BareTerm, ExtractResult, NumError, TermEntry } from './extract.ts';
import type { PlainStringKey, Strings } from '../i18n.ts';

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

/** The four categories. Also the `type` in getAllErrors output. */
export type ErrorKindId = 'art' | 'bare' | 'num' | 'dep';

/** Historical property names getAllErrors carries the raw record under. */
export type NavProp = 'ae' | 'bt' | 'ne' | 'de';

/** The record types the table describes — one per row. */
export type ErrorRecord = ArtError | BareTerm | NumError | DepError;

/**
 * The field of an ExtractResult holding `T[]`, derived rather than written out,
 * so a row cannot name a field whose records are a different shape.
 */
type FieldFor<T> = {
  [K in keyof ExtractResult]-?: ExtractResult[K] extends T[] ? K : never;
}[keyof ExtractResult];

/**
 * One error category.
 *
 * `T` is the record type this row describes. Every accessor is checked against
 * it, which is the point of the type parameter: these were all `(e: any)`
 * before, so a row reading a field its records do not have — the exact mistake
 * this table exists to make impossible — type-checked fine and produced
 * `undefined` in the UI.
 */
export interface ErrorKind<T extends ErrorRecord = ErrorRecord> {
  id: ErrorKindId;
  /** Where extractData puts the array. */
  field: FieldFor<T>;
  /** Dismissal identity within the category. */
  disId: (e: T) => string;
  /** Full dismissal key (prefix + identity). */
  disKey: (e: T) => string;
  /** Char span of the highlight. */
  start: (e: T) => number;
  end: (e: T) => number;
  /** Stemmed term, or null for the categories that name none. */
  term: (e: T) => string | null;
  /** React key for the card. */
  cardKey: (e: T) => string | number;
  /** Highlight class in styles.css. */
  hl: string;
  navProp: NavProp;
  /** Sidebar search predicate. */
  matches: (e: T, q: string, termData: Record<string, TermEntry | undefined>) => boolean;
  /** Glyph for the sidebar section header. */
  icon: string;
  /** CSS token base: `var(--<color>)`, `--<color>-bg`. */
  color: string;
  /** i18n key for the section header — must name a plain string, not a formatter. */
  sectionLbl: PlainStringKey;
  /** i18n key for the status-bar chip. */
  chipLbl: PlainStringKey;
  /** Card badge content. */
  badge: (e: T) => string;
  /** Card's second line, if any. */
  sub: ((e: T) => string) | null;
  /** Card's main line. Takes the resolved strings, so this module imports no i18n. */
  message: (e: T, t: Strings) => string;
}

/**
 * Author one row, bound to its own record type.
 *
 * This exists purely so the object literal below is checked against `ArtError`
 * (or `BareTerm`, …) rather than against the union — inference from a bare
 * array literal would widen every accessor's parameter and give back exactly
 * the `any` this replaced.
 */
const defineKind = <T extends ErrorRecord>(row: ErrorKind<T>): ErrorKind<T> => row;

const ROWS = [
  defineKind<ArtError>({
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
          : t.artGender(e.article, e.prevArt ?? ''),
  }),
  defineKind<BareTerm>({
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
  }),
  defineKind<NumError>({
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
  }),
  defineKind<DepError>({
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
  }),
] as const;

/**
 * The table as every consumer sees it.
 *
 * The record type is erased here, deliberately, and this is the ONE cast in the
 * design. Each row above is checked against its own record type — that is where
 * mistakes are actually made. But which row goes with which records is a
 * runtime invariant of this array, and TypeScript has no way to carry it
 * through: iterating a heterogeneous table hands a consumer a union of rows
 * whose accessors would then demand an intersection of all four record types.
 *
 * Erasing to `ErrorRecord` keeps consumers honest anyway — they get a union,
 * not `any`, so the only way to read a field off a record is through the row's
 * own accessor. That is precisely the discipline the table exists to enforce.
 */
export const ERROR_KINDS = ROWS as unknown as readonly ErrorKind<ErrorRecord>[];

/**
 * Rows by id, for the consumers that hold an id rather than a row.
 *
 * Total over ErrorKindId by construction — the table has exactly one row per id,
 * which errorKinds.test.js asserts — so consumers do not have to null-check a
 * lookup that cannot miss.
 */
export const KIND_BY_ID = Object.fromEntries(ERROR_KINDS.map((k) => [k.id, k])) as Record<
  ErrorKindId,
  ErrorKind<ErrorRecord>
>;

/**
 * Which card the sidebar currently focuses, and the editor highlights.
 *
 * `key` is deliberately NOT uniform: the sign string for a sign, a character
 * offset for every other kind. focusCycle, anchorIdx and each card's `focused`
 * comparison all depend on that asymmetry, so it is spelled out here rather
 * than flattened to `string | number` — which would let the two be confused.
 */
export type Focus = { type: 'sign'; key: string } | { type: ErrorKindId; key: number };

/** The records of one kind in an extraction result (never undefined). */
export function kindItems<T extends ErrorRecord>(
  res: ExtractResult | null | undefined,
  kind: ErrorKind<T>
): T[] {
  return (res?.[kind.field] ?? []) as T[];
}
