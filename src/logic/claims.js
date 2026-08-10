import { CONNECTOR_ALT, RANGE_DASHES } from './constants.js';

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

/**
 * @typedef {Object} ClaimSpan
 * @property {number} num    Claim number as written (may be out of order)
 * @property {number} start  Char offset of the claim's leading number
 * @property {number} end    Char offset where the next claim starts (or EOF)
 */

/**
 * @typedef {Object} DepError
 * @property {number} claim  The claim containing the bad reference
 * @property {number} ref    The referenced claim number
 * @property {'missing'|'forward'|'self'} type
 * @property {number} start  Char span of the referenced number (for highlight)
 * @property {number} end
 * @property {string} key    Edit-stable dismissal id: "claim>ref#ordinal"
 */

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
export function segmentClaims(text, claimNums) {
  return claimNums.map((cn, i) => ({
    num: cn.value,
    start: cn.start,
    end: i + 1 < claimNums.length ? claimNums[i + 1].start : text.length,
  }));
}

/**
 * Parse the dependency references inside one claim's text.
 * @param {string} body   The claim's text (slice of the buffer)
 * @param {number} offset Char offset of `body` in the full buffer
 * @returns {{refs: {num:number,start:number,end:number}[], nums: Set<number>,
 *            allPreceding: boolean}}
 *   `refs`  — every literally written number, with its position
 *   `nums`  — refs plus range intermediates ("1 to 4" adds 2 and 3)
 */
export function parseClaimRefs(body, offset = 0) {
  const refs = [];
  const nums = new Set();
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(body)) !== null) {
    const list = m[1];
    const listStart = m.index + m[0].length - list.length;
    const numRe = /\d{1,4}/g;
    let nm,
      prev = null;
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
 * @returns {{claims: ClaimSpan[], ancestors: Map<number, Set<number>>,
 *            depErrors: DepError[], direct: Map<number, Set<number>>} | null}
 *   null when there are no claims.
 */
export function computeClaimGraph(text, claimNums) {
  if (!claimNums || claimNums.length === 0) return null;
  const claims = segmentClaims(text, claimNums);
  const claimSet = new Set(claims.map((c) => c.num));
  /** @type {DepError[]} */
  const depErrors = [];
  const direct = new Map(); // claim num → Set of direct parent nums
  const keyCount = {};

  for (const c of claims) {
    const { refs, nums, allPreceding } = parseClaimRefs(text.slice(c.start, c.end), c.start);
    const parents = direct.get(c.num) || new Set();
    if (allPreceding) for (const o of claims) if (o.num < c.num) parents.add(o.num);
    for (const r of refs) {
      /** @type {'missing'|'self'|'forward'|null} */
      const type = !claimSet.has(r.num)
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
  const ancestors = new Map();
  function closure(num) {
    let anc = ancestors.get(num);
    if (anc) return anc;
    anc = new Set();
    ancestors.set(num, anc); // set before recursing (cheap cycle guard)
    for (const p of direct.get(num) || []) {
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
