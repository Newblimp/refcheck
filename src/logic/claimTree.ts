import { stripClaimNumber } from './constants.ts';
import type { ClaimGraph } from './claims.ts';

// ── CLAIM TREE (the dependency picture) ──────────────────────────────────────
// Lays the claim graph out as an arc diagram: one row per claim in document
// order, every back-reference drawn in a gutter to the left of the claim
// numbers, with its arrowhead on what is referred to.
//
// Why arcs and not an indented tree: a claim set is a DAG ("according to claim
// 1 or 2"), and an indented tree drawn in document order runs a parent's trunk
// straight through any claim between it and its child — "4. … according to
// claim 2" crosses claim 3. Keeping every node in one column and every edge
// strictly left of it cannot collide, whatever the shape, and keeps the
// document order the drafter reads in.
//
// A reference to a RUN of consecutive claims ("any one of the preceding
// claims", "claims 1 to 4", "claim 1 or 2") is one bracket alongside the run
// and one arrow into it, not an arc per claim: a set of twenty claims each
// "according to any one of the preceding claims" was 190 arcs, and read as a
// smudge. Brackets that open on the same claim share their lane, so that set
// draws as a single bar with an arrow from each claim to the point above it,
// and the bar turns at its top into an arrow on the claim the run opens with —
// the path reads claim → bar → claim 1, and it ends in a head like every other
// reference (a bare tick there left the bar's direction to guesswork).
//
// Pure geometry, no DOM: the component positions HTML rows at ROW pitch and
// draws each edge's `d` and `head` in an SVG of `width` × `height` behind them.

/** Row pitch in px — the component sets each row's height from this. */
export const ROW = 22;
/** The widest an arc may bulge, in px; spans past ~26 rows all reach it. */
export const MAX_BULGE = 48;
/** Arrowhead length and half-width. */
export const HEAD = 5;
const HEAD_W = 3;
/** Spacing between bracket lanes. */
export const LANE = 7;
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
  /** The dependent claim, where the line starts. */
  claim: number;
  /** What it refers back to: one claim (an arc), or a run of consecutive rows
   *  (a bracket). A claim's parents split into as many edges as they have runs. */
  refs: number[];
  /** Bracket lane, for a run; -1 for an arc. */
  lane: number;
  /** The line (for a run: the bracket, then the stroke from the claim to it). */
  d: string;
  /** The arrowhead, filled, pointing at what is referred to. */
  head: string;
}

export interface ClaimTree {
  nodes: ClaimNode[];
  edges: ClaimEdge[];
  /** x of the node column's left edge; arcs leave and arrive here. */
  nodeX: number;
  /** x of each bracket lane, left to right. */
  lanes: number[];
  width: number;
  height: number;
}

/** How far left an arc spanning `span` rows reaches. Square root, so short
 *  arcs stay apart from each other while long ones still fit the gutter. */
export const bulge = (span: number) => Math.min(MAX_BULGE, 6 + 9 * Math.sqrt(span - 1));

/** One decimal: enough for a pixel, and the path strings stay short. */
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A reference before it is placed: the claim's row and the rows it targets. */
interface Ref {
  claim: number;
  row: number;
  /** First and last referenced row (equal for a single claim). */
  lo: number;
  hi: number;
  refs: number[];
}

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

  // Split each claim's parents into runs of consecutive ROWS (rows, not
  // numbers: under out-of-order numbering only rows are adjacent on screen).
  const arcs: Ref[] = [];
  const runs: Ref[] = [];
  for (const n of nodes) {
    const rows = n.parents.flatMap((p) => rowOf.get(p) ?? []).sort((a, b) => a - b);
    for (let i = 0; i < rows.length;) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] === (rows[j] ?? 0) + 1) j++;
      const lo = rows[i] ?? 0;
      const hi = rows[j] ?? 0;
      const refs = rows.slice(i, j + 1).map((row) => nodes[row]?.num ?? 0);
      (j > i ? runs : arcs).push({ claim: n.num, row: n.row, lo, hi, refs });
      i = j + 1;
    }
  }

  // Bracket lanes. A bracket is anchored at the end away from its claim (where
  // it turns into the claim the run opens with) and takes the claim's own arrow
  // at the end nearest it; brackets sharing an
  // anchor share a lane, so "any one of the preceding claims" claim after claim
  // becomes one bar. Different anchors share a lane only with a free row between
  // them, or two bars would read as one. Greedy by start, longest first — the
  // long bars end up outermost, where the strokes to their claims cross least.
  const groups = new Map<string, { start: number; end: number; refs: Ref[] }>();
  for (const ref of runs) {
    const key = ref.row > ref.hi ? `v${ref.lo}` : `^${ref.hi}`;
    const g = groups.get(key) ?? { start: ref.lo, end: ref.hi, refs: [] };
    g.start = Math.min(g.start, ref.lo);
    g.end = Math.max(g.end, ref.hi);
    g.refs.push(ref);
    groups.set(key, g);
  }
  const laneEnds: number[] = [];
  const laneOf = new Map<Ref, number>();
  for (const g of [...groups.values()].sort((a, b) => a.start - b.start || b.end - a.end)) {
    let lane = laneEnds.findIndex((end) => end < g.start - 1);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = g.end;
    for (const ref of g.refs) laneOf.set(ref, lane);
  }
  const lanes = laneEnds.map((_, i) => 2 + i * LANE);

  // The gutter is only as wide as it needs to be: the lanes, then room for the
  // widest arc (which never reaches back into the lanes), or for the strokes
  // from the claims to the brackets when there is no arc.
  const reach = Math.max(0, ...arcs.map((a) => bulge(Math.abs(a.row - a.lo))));
  const lastLane = lanes[lanes.length - 1];
  const nodeX = Math.ceil(
    lastLane === undefined ? reach + 3 : Math.max(lastLane + 12 + reach + 1, lastLane + 24)
  );
  const y = (row: number) => row * ROW + ROW / 2;

  const edges: ClaimEdge[] = arcs.map((a) => {
    // Out-of-order numbering ("1, 3, 2") can put a parent below its claim; the
    // arc simply runs upwards, so the span is a distance.
    const y1 = y(a.row);
    const y2 = y(a.lo);
    // Both control points at one x: the cubic reaches about 3/4 of the way
    // there, so the arc's leftmost point is bulge(span) left of the column.
    const cx = r1(nodeX - (bulge(Math.abs(a.row - a.lo)) * 4) / 3);
    const tip = nodeX - 1;
    return {
      claim: a.claim,
      refs: a.refs,
      lane: -1,
      d: `M${nodeX} ${y1}C${cx} ${y1} ${cx} ${y2} ${tip - HEAD} ${y2}`,
      head: `M${tip} ${y2}l${-HEAD} ${-HEAD_W}v${2 * HEAD_W}z`,
    };
  });

  for (const ref of runs) {
    const lane = laneOf.get(ref) ?? 0;
    const x = lanes[lane] ?? 0;
    const below = ref.row > ref.hi;
    const anchor = y(below ? ref.lo : ref.hi);
    const target = y(below ? ref.hi : ref.lo);
    const yc = y(ref.row);
    // An S from the claim to the bracket's near end, level at both ends so the
    // arrow meets the bar square on; its rise sits midway, clear of the lane.
    const m = r1((x + 1 + HEAD + nodeX) / 2);
    // The far end runs level into the claim the run opens with, ending in the
    // same head an arc puts there.
    const tip = nodeX - 1;
    edges.push({
      claim: ref.claim,
      refs: ref.refs,
      lane,
      d:
        `M${tip - HEAD} ${anchor}H${x}V${target}` +
        `M${nodeX} ${yc}C${m} ${yc} ${m} ${target} ${x + 1 + HEAD} ${target}`,
      head:
        `M${x + 1} ${target}l${HEAD} ${-HEAD_W}v${2 * HEAD_W}z` +
        `M${tip} ${anchor}l${-HEAD} ${-HEAD_W}v${2 * HEAD_W}z`,
    });
  }

  return { nodes, edges, nodeX, lanes, width: nodeX + 1, height: nodes.length * ROW };
}

/**
 * What lights up while one claim is pointed at: the claims it rests on
 * (transitively), the claims resting on it, and the edges between them — the
 * reading "which claims does this one need, and what falls with it".
 * @returns claim numbers and edge indices
 */
export function claimChain(tree: ClaimTree, num: number) {
  const parentsOf = new Map(tree.nodes.map((n) => [n.num, n.parents]));
  const childrenOf = new Map<number, number[]>();
  for (const n of tree.nodes)
    for (const p of n.parents) {
      const list = childrenOf.get(p);
      if (list) list.push(n.num);
      else childrenOf.set(p, [n.num]);
    }

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

  // Every reference made BY the claim or one of its ancestors, and every
  // reference made TO the claim or one of its descendants. A bracket lights
  // whole: it is one reference to the run, even where the run holds claims
  // outside the chain.
  const edges = new Set<number>();
  tree.edges.forEach((e, i) => {
    if (up.has(e.claim) || e.refs.some((r) => down.has(r))) edges.add(i);
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
