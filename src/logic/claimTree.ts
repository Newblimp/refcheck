import { stripClaimNumber } from './constants.ts';
import type { ClaimGraph } from './claims.ts';

// ── CLAIM TREE (the dependency picture) ──────────────────────────────────────
// Lays the claim graph out as an arc diagram: one row per claim in document
// order, every dependency an arc in a gutter to the left of the claim numbers.
//
// Why arcs and not an indented tree: a claim set is a DAG ("according to claim
// 1 or 2"), and an indented tree drawn in document order runs a parent's trunk
// straight through any claim between it and its child — "4. … according to
// claim 2" crosses claim 3. Keeping every node in one column and every edge
// strictly left of it cannot collide, whatever the shape, and keeps the
// document order the drafter reads in.
//
// Pure geometry, no DOM: the component positions HTML rows at ROW pitch and
// draws `edges[].d` in an SVG of `width` × `height` behind them.

/** Row pitch in px — the component sets each row's height from this. */
export const ROW = 22;
/** The widest an arc may bulge, in px; spans past ~26 rows all reach it. */
export const MAX_BULGE = 48;
/** Opening words kept for an independent claim's label (CSS truncates). */
const LABEL_CHARS = 80;

export type ClaimNodeKind = 'independent' | 'dependent' | 'multiple';

export interface ClaimNode {
  num: number;
  /** Row index (document order). */
  row: number;
  /** independent: no parent; multiple: more than one direct parent. */
  kind: ClaimNodeKind;
  /** Direct parents, ascending. */
  parents: number[];
  /** The claim cites a nonexistent, a later or its own claim. */
  bad: boolean;
  /** Char span of the claim number, for the jump into the editor. */
  start: number;
  end: number;
  /** An independent claim's opening words — it names the family. '' otherwise. */
  label: string;
}

export interface ClaimEdge {
  /** Parent claim. */
  from: number;
  /** Dependent claim. */
  to: number;
  /** SVG path. */
  d: string;
}

export interface ClaimTree {
  nodes: ClaimNode[];
  edges: ClaimEdge[];
  /** x of the node column's left edge; arcs leave and arrive here. */
  nodeX: number;
  width: number;
  height: number;
}

/** How far left an arc spanning `span` rows reaches. Square root, so short
 *  arcs stay apart from each other while long ones still fit the gutter. */
export const bulge = (span: number) => Math.min(MAX_BULGE, 6 + 9 * Math.sqrt(span - 1));

/**
 * Lay out the claim graph.
 * @param text The buffer the graph was computed from (for the labels).
 * @returns null when there are no claims.
 */
export function buildClaimTree(graph: ClaimGraph | null, text: string): ClaimTree | null {
  if (!graph || !graph.claims.length) return null;
  const bad = new Set(graph.depErrors.map((e) => e.claim));

  // One row per claim NUMBER, at its first occurrence. A duplicated number is a
  // numbering error with its own card; `direct` is keyed by number anyway, so a
  // second row could only repeat the first one's arcs.
  const nodes: ClaimNode[] = [];
  const rowOf = new Map<number, number>();
  for (const c of graph.claims) {
    if (rowOf.has(c.num)) continue;
    rowOf.set(c.num, nodes.length);
    const parents = [...(graph.direct.get(c.num) ?? [])].sort((a, b) => a - b);
    const numLen = /^\d+/.exec(text.slice(c.start, c.start + 5))?.[0].length ?? 0;
    nodes.push({
      num: c.num,
      row: nodes.length,
      kind: !parents.length ? 'independent' : parents.length > 1 ? 'multiple' : 'dependent',
      parents,
      bad: bad.has(c.num),
      start: c.start,
      end: c.start + numLen,
      label: parents.length
        ? ''
        : stripClaimNumber(text.slice(c.start, c.end))
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, LABEL_CHARS),
    });
  }

  const pairs: [number, number, number][] = []; // [from, to, span]
  let reach = 0;
  for (const n of nodes)
    for (const p of n.parents) {
      const pr = rowOf.get(p);
      if (pr === undefined) continue;
      // Out-of-order numbering ("1, 3, 2") can put a parent below its child;
      // the arc simply runs upwards, so span is a distance.
      const span = Math.abs(n.row - pr);
      pairs.push([p, n.num, span]);
      reach = Math.max(reach, bulge(span));
    }

  // The gutter is only as wide as the widest arc needs, so a set of short
  // references sits close to the left edge.
  const nodeX = Math.ceil(reach) + 2;
  const y = (row: number) => row * ROW + ROW / 2;
  const edges = pairs.map(([from, to, span]): ClaimEdge => {
    const y1 = y(rowOf.get(from) ?? 0);
    const y2 = y(rowOf.get(to) ?? 0);
    // Both control points at the same x: a cubic reaches 3/4 of the way to
    // them, so this arc's leftmost point is exactly bulge(span) from nodeX.
    const cx = nodeX - (bulge(span) * 4) / 3;
    return { from, to, d: `M${nodeX} ${y1}C${cx} ${y1} ${cx} ${y2} ${nodeX} ${y2}` };
  });

  return { nodes, edges, nodeX, width: nodeX + 1, height: nodes.length * ROW };
}

/**
 * What lights up while one claim is pointed at: the claims it rests on
 * (transitively), the claims resting on it, and the arcs between them — the
 * reading "which claims does this one need, and what falls with it".
 * @returns claim numbers and edge indices
 */
export function claimChain(tree: ClaimTree, num: number) {
  const parentsOf = new Map(tree.nodes.map((n) => [n.num, n.parents]));
  const childrenOf = new Map<number, number[]>();
  for (const e of tree.edges) childrenOf.set(e.from, [...(childrenOf.get(e.from) ?? []), e.to]);

  const walk = (start: number, next: Map<number, number[]>) => {
    const seen = new Set<number>([start]);
    const stack = [start];
    for (let n = stack.pop(); n !== undefined; n = stack.pop())
      for (const m of next.get(n) ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        stack.push(m);
      }
    return seen;
  };
  const up = walk(num, parentsOf);
  const down = walk(num, childrenOf);

  // Every arc INTO the claim or one of its ancestors, and every arc OUT of the
  // claim or one of its descendants. The other ends are in the chain by
  // construction, so nothing outside it is ever lit.
  const edges = new Set<number>();
  tree.edges.forEach((e, i) => {
    if (up.has(e.to) || down.has(e.from)) edges.add(i);
  });
  return { nodes: new Set([...up, ...down]), edges };
}

/** "1, 2, 3, 4, 7" → "1–4, 7". Input ascending. */
export function compactRanges(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length;) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === (nums[j] ?? 0) + 1) j++;
    // Two in a row read better as a list than as a range.
    out.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : nums.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}
