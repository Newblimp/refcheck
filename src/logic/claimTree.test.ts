import { describe, it, expect } from 'vitest';
import { must } from '../test/helpers.ts';
import { computeClaimGraph } from './claims.ts';
import type { ClaimNumber } from './claims.ts';
import {
  HEAD,
  LANE,
  MAX_BULGE,
  ROW,
  buildClaimTree,
  bulge,
  claimChain,
  compactRanges,
} from './claimTree.ts';
import type { ClaimEdge, ClaimTree } from './claimTree.ts';

// claimNums as extractData produces them (line-leading numbers).
const nums = (text: string): ClaimNumber[] => {
  const out: ClaimNumber[] = [];
  const re = /^[ \t]*(\d+)[.)]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const written = m[1] ?? '';
    const s = m.index + m[0].indexOf(written);
    out.push({ value: parseInt(written, 10), start: s, end: s + written.length });
  }
  return out;
};
const tree = (lines: string[]) => {
  const text = lines.join('\n');
  return { text, tree: must(buildClaimTree(computeClaimGraph(text, nums(text)), text)) };
};
// The numbers in a path, in order.
const pathNums = (d: string) => d.match(/-?[\d.]+/g)?.map(Number) ?? [];
// An edge as "claim>refs".
const label = (e: ClaimEdge) => `${e.claim}>${compactRanges(e.refs)}`;
const rowY = (t: ClaimTree, num: number) =>
  must(t.nodes.find((n) => n.num === num)).row * ROW + ROW / 2;
// The leftmost point of an arc ("M x0 y0 C cx y0 cx y1 x1 y1"), sampled.
const leftmost = (d: string) => {
  const [x0, , c1, , c2, , x1] = pathNums(d);
  let min = Infinity;
  for (let t = 0; t <= 1; t += 0.01) {
    const u = 1 - t;
    min = Math.min(min, u * u * u * x0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * x1);
  }
  return min;
};

const SET = [
  '1. A device (10) for cleaning windows, comprising a housing (12).',
  '2. The device (10) of claim 1, wherein the housing (12) is metal.',
  '3. The device (10) of claim 1, wherein the housing (12) is round.',
  '4. The device (10) of claim 2, further comprising a brush (14).',
  '5. A method of cleaning a window.',
  '6. The method of claim 5 or 7, wherein the window is wet.',
];

describe('buildClaimTree', () => {
  it('is null without claims', () => {
    expect(buildClaimTree(null, '')).toBeNull();
    expect(buildClaimTree(computeClaimGraph('no claims', []), 'no claims')).toBeNull();
  });

  it('gives each claim a row in document order, with its kind and ascending parents', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. The device (10) of claim 1.',
      '3. The device (10) of claim 2 or 1.',
    ]);
    expect(t.nodes.map((n) => [n.num, n.row, n.kind, n.parents])).toEqual([
      [1, 0, 'independent', []],
      [2, 1, 'dependent', [1]],
      [3, 2, 'multiple', [1, 2]],
    ]);
    expect(t.height).toBe(3 * ROW);
  });

  it("selects the claim's number for the jump", () => {
    const lines = SET.slice(0, 4);
    lines.push('12. The device (10) of claim 3.');
    const { text, tree: t } = tree(lines);
    for (const n of t.nodes) expect(text.slice(n.start, n.end)).toBe(String(n.num));
  });

  it("labels only independent claims, with the claim's opening words", () => {
    const { tree: t } = tree(SET);
    const label = (num: number) => t.nodes.find((n) => n.num === num)?.label;
    expect(label(1)).toBe('A device (10) for cleaning windows, comprising a housing (12).');
    expect(label(5)).toBe('A method of cleaning a window.');
    expect(label(2)).toBe('');
  });

  it('collapses whitespace in a label and caps its length', () => {
    const { tree: t } = tree([`1.   A device\n\t(10) ${'very '.repeat(40)}long.`]);
    const label = must(t.nodes[0]).label;
    expect(label.startsWith('A device (10) very very')).toBe(true);
    expect(label).toHaveLength(80);
  });

  it('marks a claim with an invalid reference, and keeps its valid arcs', () => {
    const { tree: t } = tree(SET);
    const six = must(t.nodes.find((n) => n.num === 6));
    expect(six.bad).toBe(true);
    expect(six.parents).toEqual([5]);
    expect(t.nodes.filter((n) => n.bad).map((n) => n.num)).toEqual([6]);
  });

  it('draws no arc for an invalid reference', () => {
    const { tree: t } = tree(['1. A device (10).', '2. The device (10) of claim 9.']);
    expect(t.edges).toEqual([]);
    expect(must(t.nodes[1]).bad).toBe(true);
  });

  it('draws one row per claim number when a number is duplicated', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. The device (10) of claim 1.',
      '2. The device (10) of claim 1.',
    ]);
    expect(t.nodes.map((n) => n.num)).toEqual([1, 2]);
    expect(t.edges).toHaveLength(1);
  });

  it('draws one arc per single back-reference, from the claim to the claim it cites', () => {
    const { tree: t } = tree(SET);
    expect(t.edges.map(label)).toEqual(['2>1', '3>1', '4>2', '6>5']);
    expect(t.edges.every((e) => e.lane === -1)).toBe(true);
    expect(t.lanes).toEqual([]);
  });

  it('starts every arc at its claim and ends it in an arrowhead on the cited claim', () => {
    const { tree: t } = tree(SET);
    for (const e of t.edges) {
      const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = pathNums(e.d);
      expect([x1, y1, cy1]).toEqual([t.nodeX, rowY(t, e.claim), rowY(t, e.claim)]);
      expect([cy2, y2]).toEqual([rowY(t, e.refs[0]), rowY(t, e.refs[0])]);
      expect(cx1).toBe(cx2);
      // The line stops at the arrowhead's base; the tip touches the pill and
      // points right, into it.
      const [tip, ty, dx] = pathNums(e.head);
      expect([tip, ty]).toEqual([t.nodeX - 1, y2]);
      expect(dx).toBe(-HEAD);
      expect(x2).toBe(tip + dx);
    }
  });

  it('keeps every arc inside the drawing, reaching further for a longer span', () => {
    const lines = ['1. A device (10).'];
    for (let i = 2; i <= 40; i++) lines.push(`${i}. The device (10) of claim 1.`);
    const { tree: t } = tree(lines);
    const lefts = t.edges.map((e) => leftmost(e.d));
    t.edges.forEach((e, i) => {
      const span = Math.abs(rowY(t, e.claim) - rowY(t, e.refs[0])) / ROW;
      expect(lefts[i]).toBeGreaterThan(0);
      expect(Math.abs(lefts[i] - (t.nodeX - bulge(span)))).toBeLessThan(1.5);
      if (i) expect(lefts[i]).toBeLessThanOrEqual(lefts[i - 1]);
    });
    expect(lefts.at(-1)).toBeLessThan(lefts[0] - 30);
    expect(t.width).toBeGreaterThan(t.nodeX);
  });

  it('reaches a cited claim written below when numbering is out of order', () => {
    const { tree: t } = tree(['1. A device (10).', '3. The device (10) of claim 2.', '2. A cap.']);
    const [e] = t.edges;
    expect(label(e)).toBe('3>2');
    const [, y1, , , , , , y2] = pathNums(e.d);
    expect(y2).toBeGreaterThan(y1);
  });

  it('sizes the gutter to the widest arc', () => {
    const near = tree(['1. A device (10).', '2. The device (10) of claim 1.']).tree;
    const far = tree([
      '1. A device (10).',
      '2. A cap.',
      '3. A lid.',
      '4. The device of claim 1.',
    ]).tree;
    expect(near.nodeX).toBeLessThan(far.nodeX);
    expect(far.nodeX).toBeLessThanOrEqual(MAX_BULGE + 4);
  });
});

describe('buildClaimTree — references to a run of claims', () => {
  // The shape that made the arc-per-reference drawing unreadable.
  const PRECEDING = ['1. A device (10).'];
  for (let i = 2; i <= 8; i++)
    PRECEDING.push(`${i}. The device (10) of any one of the preceding claims.`);

  it('draws one bracket per run instead of an arc per claim', () => {
    const { tree: t } = tree(PRECEDING);
    // 7 edges, not the 28 one arc per reference would draw.
    expect(t.edges.map(label)).toEqual([
      '2>1',
      '3>1, 2',
      '4>1–3',
      '5>1–4',
      '6>1–5',
      '7>1–6',
      '8>1–7',
    ]);
  });

  it('puts brackets that open on the same claim in one lane — one bar', () => {
    const { tree: t } = tree(PRECEDING);
    expect(t.lanes).toHaveLength(1);
    expect(new Set(t.edges.filter((e) => e.refs.length > 1).map((e) => e.lane))).toEqual(
      new Set([0])
    );
  });

  it('splits a claim’s references into runs and single claims', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. A cap.',
      '3. A lid.',
      '4. A box.',
      '5. A rim.',
      '6. The device (10) of claim 1 or any one of claims 3 to 5.',
    ]);
    expect(t.edges.map(label)).toEqual(['6>1', '6>3–5']);
    expect(t.edges.map((e) => e.lane)).toEqual([-1, 0]);
  });

  it('draws a bracket along its run, the arrow at the end nearest its claim', () => {
    const { tree: t } = tree(PRECEDING);
    for (const e of t.edges.filter((e) => e.refs.length > 1)) {
      const x = t.lanes[e.lane];
      const [open, anchor, bar, target, sx, sy, , , , , ex, ey] = pathNums(e.d);
      // The bar: from the first claim of the run down to the last.
      expect([bar, anchor, target]).toEqual([
        x,
        rowY(t, e.refs[0]),
        rowY(t, e.refs[e.refs.length - 1]),
      ]);
      // The stroke: from the claim to the arrow's base at the bar's near end.
      expect([sx, sy, ey]).toEqual([t.nodeX, rowY(t, e.claim), target]);
      const [tip, ty, dx, , , tip2, ty2, dx2] = pathNums(e.head);
      expect([tip, ty]).toEqual([x + 1, target]);
      expect(dx).toBe(HEAD); // base to the right: the arrow points left, at the bar
      expect(ex).toBe(tip + dx);
      // The far end turns level into the run's first claim, with the head an
      // arc would put there: tip on the pill, pointing right.
      expect([tip2, ty2, dx2]).toEqual([t.nodeX - 1, anchor, -HEAD]);
      expect(open).toBe(tip2 + dx2);
    }
  });

  it('opens a bracket towards a claim written above its run', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '4. The device (10) of claim 2 or 3.',
      '2. A cap.',
      '3. A lid.',
    ]);
    const [e] = t.edges;
    expect(label(e)).toBe('4>2, 3');
    const [, anchor, , target, , sy] = pathNums(e.d);
    // Into claim 3 at the far (lower) end, the claim's arrow at the near one.
    expect([target, anchor]).toEqual([rowY(t, 2), rowY(t, 3)]);
    expect(sy).toBeLessThan(target);
  });

  it('gives overlapping brackets that open on different claims their own lanes', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. A cap.',
      '3. A lid.',
      '4. The device (10) of any one of claims 1 to 3.',
      '5. The device (10) of any one of claims 2 to 4.',
    ]);
    expect(t.edges.map((e) => e.lane)).toEqual([0, 1]);
    expect(t.lanes).toHaveLength(2);
    expect(t.lanes[1]).toBe(t.lanes[0] + LANE);
  });

  it('shares a lane between brackets only with a free row between them', () => {
    const lanes = (lines: string[]) => tree(lines).tree.lanes.length;
    const head = ['1. A device (10).', '2. A cap.', '3. The device (10) of claim 1 or 2.'];
    // Rows 1–2 and 4–5: row 3 is free.
    expect(lanes([...head, '4. A lid.', '5. A box.', '6. The lid of claim 4 or 5.'])).toBe(1);
    // Rows 1–2 and 3–4: they would read as one bar.
    expect(lanes([...head, '4. A lid.', '5. The lid of claim 3 or 4.'])).toBe(2);
  });

  it('keeps arcs clear of the bracket lanes', () => {
    const { tree: t } = tree([...PRECEDING, '9. A use of the device of claim 1.']);
    const arc = must(t.edges.find((e) => e.lane === -1 && e.claim === 9));
    expect(leftmost(arc.d)).toBeGreaterThan(t.lanes[0] + 6);
  });
});

describe('bulge', () => {
  it('grows with the span and stops at MAX_BULGE', () => {
    const b = [1, 2, 3, 5, 10, 20].map(bulge);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
    expect(bulge(500)).toBe(MAX_BULGE);
  });
});

describe('claimChain', () => {
  const lit = (t: ClaimTree, num: number) => {
    const c = claimChain(t, num);
    return {
      nodes: [...c.nodes].sort((a, b) => a - b),
      edges: [...c.edges].map((i) => label(t.edges[i])).sort(),
    };
  };

  it('lights the ancestors, the descendants and the references between them only', () => {
    const { tree: t } = tree(SET);
    // 2 rests on 1 and carries 4; its sibling 3 and the method family stay dark.
    expect(lit(t, 2)).toEqual({ nodes: [1, 2, 4], edges: ['2>1', '4>2'] });
    expect(lit(t, 1)).toEqual({ nodes: [1, 2, 3, 4], edges: ['2>1', '3>1', '4>2'] });
    expect(lit(t, 5)).toEqual({ nodes: [5, 6], edges: ['6>5'] });
  });

  it('follows every alternative of a multiple dependency', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. The device (10) of claim 1.',
      '3. The device (10) of claim 1 or 2.',
    ]);
    expect(lit(t, 3)).toEqual({ nodes: [1, 2, 3], edges: ['2>1', '3>1, 2'] });
  });

  it('lights a bracket whole when one claim of its run is in the chain', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. The device (10) of claim 1.',
      '3. A cap.',
      '4. The device (10) of claim 2 or 3.',
    ]);
    // 3 is cited only through the bracket; 2, also in it, stays dark itself.
    expect(lit(t, 3)).toEqual({ nodes: [3, 4], edges: ['4>2, 3'] });
    expect(lit(t, 1)).toEqual({ nodes: [1, 2, 4], edges: ['2>1', '4>2, 3'] });
  });
});

describe('compactRanges', () => {
  it('folds three or more consecutive numbers into a range', () => {
    expect(compactRanges([1, 2, 3, 4, 7])).toBe('1–4, 7');
    expect(compactRanges([1, 2, 5, 6, 7, 9])).toBe('1, 2, 5–7, 9');
    expect(compactRanges([3])).toBe('3');
    expect(compactRanges([])).toBe('');
  });
});
