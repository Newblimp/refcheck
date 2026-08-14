import { CONNECTOR_ALT, RANGE_DASHES } from './constants.ts';

// ── CLAIM STRUCTURE ──────────────────────────────────────────────────────────
// Segments the claims buffer into individual claims, parses each claim's
// dependency references ("according to claim 3", "nach einem der Ansprüche 1
// bis 4", "any one of the preceding claims"), and derives:
//   • depErrors  — references to nonexistent claims, forward references and
//                  self-references
//   • ancestors  — per claim, the transitive closure of the claims it depends
//                  on (used for per-claim antecedent-basis checking)
// EN and DE patterns are always both parsed; they cannot collide and drafts
// occasionally mix languages.

/** A line-leading claim number as the extraction scan found it. */
export interface ClaimNumber {
  /** The number as written. */
  value: number;
  /** Char span of the number itself. */
  start: number;
  end: number;
}

/** One claim's extent in the buffer. */
export interface ClaimSpan {
  /** Claim number as written (may be out of order). */
  num: number;
  /** Char offset of the claim's leading number. */
  start: number;
  /** Char offset where the next claim starts (or EOF). */
  end: number;
}

/** Why a dependency reference is wrong. */
export type DepErrorType = 'missing' | 'forward' | 'self';

export interface DepError {
  /** The claim containing the bad reference. */
  claim: number;
  /** The referenced claim number. */
  ref: number;
  type: DepErrorType;
  /** Char span of the referenced number (for the highlight). */
  start: number;
  end: number;
  /** Edit-stable dismissal id: "claim>ref#ordinal". */
  key: string;
}

/** One literally written claim reference, with where it sits in the buffer. */
export interface ClaimRef {
  num: number;
  start: number;
  end: number;
}

/** What `parseClaimRefs` found inside one claim. */
export interface ParsedClaimRefs {
  /** Every literally written number, with its position. */
  refs: ClaimRef[];
  /** `refs` plus range intermediates ("1 to 4" adds 2 and 3). */
  nums: Set<number>;
  /** The claim used a "preceding claims" phrase. */
  allPreceding: boolean;
}

/** The whole dependency picture for a claims buffer. */
export interface ClaimGraph {
  claims: ClaimSpan[];
  /** Per claim, the transitive closure of the claims it depends on. */
  ancestors: Map<number, Set<number>>;
  depErrors: DepError[];
  /**
   * Each claim's immediate parents. Part of the contract, not an implementation
   * detail: claimStats reads it to tell an independent claim from a dependent
   * one and to spot multiple dependency, without re-parsing.
   */
  direct: Map<number, Set<number>>;
}

// "claim(s) 1, 2 or 4 to 7" — the word, then a number list whose connectors are
// commas, EN/DE conjunctions or range words/dashes. The list regex backtracks
// cleanly at "claim 1, wherein…" (no digits after the comma → list is just "1").
// Cap on how many intermediate claim numbers a range may expand to. "claims 1
// to 4" should yield 2 and 3; a nonsense range like "1 to 9999" should not
// allocate thousands of entries, so it is treated as two endpoints instead.
const MAX_RANGE_SPAN = 200;

const NUM_LIST = `\\d{1,4}(?:\\s*(?:,|${CONNECTOR_ALT}|${RANGE_DASHES})\\s*\\d{1,4})*`;
const REF_RE = new RegExp(String.raw`\b(?:claims?|anspr(?:uch|üche|üchen))\s+(${NUM_LIST})`, 'gi');
// Connectors that make the pair around them a range (endpoints expanded).
const RANGE_SEP = /(?:^|\s|,)(?:to|through|bis)(?:\s|$)|[-–—]/i;
// "any one of the preceding claims" / "einem der vorhergehenden Ansprüche".
const PRECEDING_RE =
  /\bpreceding\s+claims?\b|\bvorher(?:ig|gehend)en\s+anspr|\bvorstehenden\s+anspr|\bvorangehenden\s+anspr/i;

/** Split the claims text into per-claim spans. `claimNums` comes from
 *  extractData's line-leading claim-number scan and is in document order. */
export function segmentClaims(text: string, claimNums: ClaimNumber[]): ClaimSpan[] {
  return claimNums.map((cn, i) => ({
    num: cn.value,
    start: cn.start,
    end: claimNums[i + 1]?.start ?? text.length,
  }));
}

/**
 * Parse the dependency references inside one claim's text.
 * @param body   The claim's text (slice of the buffer)
 * @param offset Char offset of `body` in the full buffer
 */
export function parseClaimRefs(body: string, offset = 0): ParsedClaimRefs {
  const refs: ClaimRef[] = [];
  const nums = new Set<number>();
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(body)) !== null) {
    // Group 1 is the number list and cannot be absent when exec matched.
    const list = m[1] ?? '';
    const listStart = m.index + m[0].length - list.length;
    const numRe = /\d{1,4}/g;
    let nm: RegExpExecArray | null;
    let prev: { num: number; endIdx: number } | null = null;
    while ((nm = numRe.exec(list)) !== null) {
      const num = parseInt(nm[0], 10);
      refs.push({
        num,
        start: offset + listStart + nm.index,
        end: offset + listStart + nm.index + nm[0].length,
      });
      nums.add(num);
      if (
        prev !== null &&
        RANGE_SEP.test(list.slice(prev.endIdx, nm.index)) &&
        num - prev.num < MAX_RANGE_SPAN
      )
        for (let k = prev.num + 1; k < num; k++) nums.add(k);
      prev = { num, endIdx: nm.index + nm[0].length };
    }
  }
  return { refs, nums, allPreceding: PRECEDING_RE.test(body) };
}

/**
 * Build the full claim graph for a claims buffer.
 *
 * `direct` (each claim's immediate parents) is part of the contract, not an
 * implementation detail: claimStats reads it to tell an independent claim from a
 * dependent one and to spot multiple dependency, without re-parsing.
 *
 * @returns null when there are no claims.
 */
export function computeClaimGraph(text: string, claimNums: ClaimNumber[]): ClaimGraph | null {
  if (!claimNums || claimNums.length === 0) return null;
  const claims = segmentClaims(text, claimNums);
  const claimSet = new Set(claims.map((c) => c.num));
  const depErrors: DepError[] = [];
  /** claim num → Set of direct parent nums */
  const direct = new Map<number, Set<number>>();
  const keyCount: Record<string, number> = {};

  for (const c of claims) {
    const { refs, nums, allPreceding } = parseClaimRefs(text.slice(c.start, c.end), c.start);
    const parents = direct.get(c.num) || new Set();
    if (allPreceding) for (const o of claims) if (o.num < c.num) parents.add(o.num);
    for (const r of refs) {
      const type: DepErrorType | null = !claimSet.has(r.num)
        ? 'missing'
        : r.num === c.num
          ? 'self'
          : r.num > c.num
            ? 'forward'
            : null;
      if (type) {
        const base = `${c.num}>${r.num}`;
        const n = (keyCount[base] = (keyCount[base] || 0) + 1);
        depErrors.push({
          claim: c.num,
          ref: r.num,
          type,
          start: r.start,
          end: r.end,
          key: `${base}#${n}`,
        });
      }
    }
    // Only backward references to existing claims form dependency edges, so the
    // graph is acyclic by construction (range intermediates included).
    for (const n of nums) if (claimSet.has(n) && n < c.num) parents.add(n);
    direct.set(c.num, parents);
  }

  // Transitive closure (memoized DFS; the graph is acyclic, see above).
  const ancestors = new Map<number, Set<number>>();
  function closure(num: number): Set<number> {
    let anc = ancestors.get(num);
    if (anc) return anc;
    anc = new Set<number>();
    ancestors.set(num, anc); // set before recursing (cheap cycle guard)
    // Parents highest-first, skipping any already reached through an earlier
    // one. Ancestry is transitive, so a parent that is already in `anc` came in
    // with the whole of ITS closure, and merging that closure again can only
    // re-add what is there. On the ordinary "any one of the preceding claims"
    // shape — every claim depending on all the ones before it — the first
    // parent supplies the entire set and every other one is a single lookup,
    // which is what takes this from O(claims³) to O(claims²).
    for (const p of [...(direct.get(num) ?? [])].sort((a, b) => b - a)) {
      if (anc.has(p)) continue;
      anc.add(p);
      for (const g of closure(p)) anc.add(g);
    }
    return anc;
  }
  for (const c of claims) closure(c.num);

  // `direct` is exposed so claimStats can tell an independent claim from a
  // dependent one, and spot multiple dependencies, without re-parsing.
  return { claims, ancestors, depErrors, direct };
}
