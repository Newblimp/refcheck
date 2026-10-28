import { describe, it, expect } from 'vitest';
import { must } from '../test/helpers.ts';
import { computeClaimGraph } from './claims.ts';
import type { ClaimNumber } from './claims.ts';
import { MAX_BULGE, ROW, buildClaimTree, bulge, claimChain, compactRanges } from './claimTree.ts';

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
// The numbers in an edge's path: M x1 y1 C cx y1 cx y2 x2 y2.
const pathNums = (d: string) => d.match(/-?[\d.]+/g)?.map(Number) ?? [];

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

  it('draws one arc per direct dependency, parent to dependent', () => {
    const { tree: t } = tree(SET);
    expect(t.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['1>2', '1>3', '2>4', '5>6']);
  });

  it('starts and ends every arc on its rows, at the node column', () => {
    const { tree: t } = tree(SET);
    const rowY = (num: number) => must(t.nodes.find((n) => n.num === num)).row * ROW + ROW / 2;
    for (const e of t.edges) {
      const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = pathNums(e.d);
      expect([x1, x2]).toEqual([t.nodeX, t.nodeX]);
      expect([y1, cy1, cy2, y2]).toEqual([rowY(e.from), rowY(e.from), rowY(e.to), rowY(e.to)]);
      expect(cx1).toBe(cx2);
    }
  });

  it('keeps every arc inside the drawing, reaching exactly bulge(span) left', () => {
    const lines = ['1. A device (10).'];
    for (let i = 2; i <= 40; i++) lines.push(`${i}. The device (10) of claim 1.`);
    const { tree: t } = tree(lines);
    for (const e of t.edges) {
      const [x1, y1, cx, , , , , y2] = pathNums(e.d);
      const span = Math.abs(y2 - y1) / ROW;
      // A cubic with both control points at cx reaches 3/4 of the way there.
      const left = x1 + 0.75 * (cx - x1);
      expect(left).toBeCloseTo(t.nodeX - bulge(span));
      expect(left).toBeGreaterThan(0);
    }
    expect(t.width).toBeGreaterThan(t.nodeX);
  });

  it('runs an arc upwards when numbering is out of order', () => {
    const { tree: t } = tree(['1. A device (10).', '3. The device (10) of claim 2.', '2. A cap.']);
    const [e] = t.edges;
    expect(`${e.from}>${e.to}`).toBe('2>3');
    const [, y1, , , , , , y2] = pathNums(e.d);
    expect(y1).toBeGreaterThan(y2);
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
    expect(far.nodeX).toBeLessThanOrEqual(MAX_BULGE + 3);
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
  const lit = (t: ReturnType<typeof tree>['tree'], num: number) => {
    const c = claimChain(t, num);
    return {
      nodes: [...c.nodes].sort((a, b) => a - b),
      edges: [...c.edges].map((i) => `${t.edges[i].from}>${t.edges[i].to}`).sort(),
    };
  };

  it('lights the ancestors, the descendants and the arcs between them only', () => {
    const { tree: t } = tree(SET);
    // 2 rests on 1 and carries 4; its sibling 3 and the method family stay dark.
    expect(lit(t, 2)).toEqual({ nodes: [1, 2, 4], edges: ['1>2', '2>4'] });
    expect(lit(t, 1)).toEqual({ nodes: [1, 2, 3, 4], edges: ['1>2', '1>3', '2>4'] });
    expect(lit(t, 5)).toEqual({ nodes: [5, 6], edges: ['5>6'] });
  });

  it('follows every alternative of a multiple dependency', () => {
    const { tree: t } = tree([
      '1. A device (10).',
      '2. The device (10) of claim 1.',
      '3. The device (10) of claim 1 or 2.',
    ]);
    expect(lit(t, 3)).toEqual({ nodes: [1, 2, 3], edges: ['1>2', '1>3', '2>3'] });
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
