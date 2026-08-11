import { classify } from './extract.ts';
import { disKey } from './constants.ts';
import { ERROR_KINDS, KIND_BY_ID, kindItems } from './errorKinds.ts';
import type { ErrorKindId, ErrorRecord } from './errorKinds.ts';
import type { DepError } from './claims.ts';
import type { Mode } from './constants.ts';
import type { ArtError, BareTerm, ExtractResult, NumError, Severity } from './extract.ts';

// ── ERROR SPANS ─────────────────────────────────────────────────────────────
//
// One traversal of "everything the app considers an error, and where it sits in
// the text", shared by the two consumers that need it:
//
//   • buildHtml   — turns spans into <mark> elements for the backdrop
//   • getAllErrors — turns them into a document-ordered navigation list
//
// Both used to walk the same five categories with the same dismissal rules in
// their own copy of the loop. Keeping the categories in one place means adding a
// sixth error type touches one function rather than two that must be kept in
// step — and it stops the highlighter and the error navigator from silently
// disagreeing about what counts as an error.

// The span is a discriminated union on `kind` rather than one shape with four
// optional fields. That is not decoration: `sev` is present exactly when the
// span is a sign, and with it optional every consumer had to either assert or
// risk indexing HL with undefined. Narrowing on `kind` now proves it.
//
// The two sign shapes are SEPARATE members carrying ONE literal `kind` each,
// rather than one member with `'sign'|'signTerm'`. That is a language
// constraint, not a stylistic choice, and it survived the migration unchanged:
// TypeScript does not eliminate a union member whose discriminant is itself a
// union of literals, even when every one of those literals has been excluded.
// With the two merged, `getAllErrors` could not reach `sp.item` after ruling out
// both sign kinds without an assertion. One literal per member and it narrows.
// (This was previously recorded as a JSDoc limitation. It is not — plain
// TypeScript behaves identically; see docs/typescript-migration.md.)

/** How a sign or its term is highlighted. Dismissed signs still render, greyed. */
export type SpanSeverity = Severity | 'dis';

/** A sign occurrence. */
export interface SignSpan {
  kind: 'sign';
  start: number;
  end: number;
  sign: string;
  sev: SpanSeverity;
  /** The term stem of THIS occurrence. */
  term: string;
}

/**
 * The term attached to a warned sign — highlighted alongside it, but never a
 * navigation target of its own.
 */
export interface SignTermSpan {
  kind: 'signTerm';
  start: number;
  end: number;
  sign: string;
  sev: SpanSeverity;
  term: string;
}

/** One of the four ERROR_KINDS categories. */
export interface KindSpan {
  kind: ErrorKindId;
  start: number;
  end: number;
  /** null for the categories that name no term. */
  term: string | null;
  /** The originating error record. */
  item: ErrorRecord;
}

export type ErrorSpan = SignSpan | SignTermSpan | KindSpan;

/** A warned sign, as the navigator steps through it. */
export interface SignErrorEntry {
  type: 'sign';
  start: number;
  end: number;
  sign: string;
  term: string;
}

/**
 * One categorised error, as the navigator steps through it.
 *
 * The raw record rides along under its category's historical `navProp` name.
 * These are read by name in App and in the tests, which is why they are spelled
 * out here rather than derived — see the note in errorKinds.ts.
 */
export interface KindErrorEntry {
  type: ErrorKindId;
  start: number;
  end: number;
  term: string | null;
  ae?: ArtError;
  bt?: BareTerm;
  ne?: NumError;
  de?: DepError;
}

export type ErrorEntry = SignErrorEntry | KindErrorEntry;

/**
 * Visit every span of interest, in no particular order.
 *
 * Signs are reported whatever their severity — including dismissed ones, which
 * the backdrop still renders (greyed) even though the navigator skips them. The
 * four error categories are reported only when not dismissed, which is what both
 * consumers want.
 *
 */
export function eachErrorSpan(
  res: ExtractResult,
  mode: Mode,
  dis: Set<string>,
  visit: (span: ErrorSpan) => void
): void {
  const { signData, termData } = res;

  for (const [sign, sData] of Object.entries(signData)) {
    const sev: SpanSeverity = dis.has(disKey.sign(sign)) ? 'dis' : classify(sData, termData, mode);
    for (const p of sData.positions) {
      visit({ kind: 'sign', start: p.signStart, end: p.signEnd, sign, sev, term: p.termStem });
      // The term a warned sign is attached to is highlighted alongside it.
      if (sev === 'warn')
        visit({
          kind: 'signTerm',
          start: p.termStart,
          end: p.termEnd,
          sign,
          sev,
          term: p.termStem,
        });
    }
  }
  // The four non-sign categories differ only in the accessors ERROR_KINDS
  // already names, so they are one loop rather than four copies of it.
  for (const kind of ERROR_KINDS) {
    for (const item of kindItems(res, kind)) {
      if (dis.has(kind.disKey(item))) continue;
      visit({
        kind: kind.id,
        start: kind.start(item),
        end: kind.end(item),
        term: kind.term(item),
        item,
      });
    }
  }
}

/**
 * Every active error, in document order — what the status-bar arrows step through.
 * Dismissed signs and dismissed errors are excluded; consistent signs are not
 * errors and are excluded too.
 *
 */
export function getAllErrors(res: ExtractResult, mode: Mode, dis: Set<string>): ErrorEntry[] {
  const out: ErrorEntry[] = [];
  eachErrorSpan(res, mode, dis, (sp) => {
    // Both sign shapes are handled in one branch, so what follows is a KindSpan
    // by elimination — which is also what lets `sp.item` below be reached
    // without an assertion.
    if (sp.kind === 'sign' || sp.kind === 'signTerm') {
      // Only a warned sign is an error to step through, and the term beside it
      // is a highlight rather than a target of its own.
      if (sp.kind === 'signTerm' || sp.sev !== 'warn') return;
      out.push({ type: 'sign', start: sp.start, end: sp.end, sign: sp.sign, term: sp.term });
      return;
    }
    out.push({
      type: sp.kind,
      start: sp.start,
      end: sp.end,
      term: sp.term,
      [KIND_BY_ID[sp.kind].navProp]: sp.item,
    });
  });
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Grouping key for "jump to the next error about the same term" navigation
 * (Ctrl+Shift+↓/↑).
 *
 * Everything that names a term groups by its STEM, so an inconsistent sign, the
 * article in front of it and a bare occurrence of the same noun all belong to
 * one group — that is what makes stepping through "banana" skip "kiwi". Claim
 * numbering and dependency errors have no term at all; they group by category
 * rather than sharing one nameless bucket, which would make the jump behave like
 * the plain next-error arrow for them.
 *
 * @param e An entry from getAllErrors
 */
export function errorGroup(e: { type: string; term?: string | null } | null | undefined): string {
  return e?.term ? `t:${e.term}` : `k:${e?.type}`;
}
