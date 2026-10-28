import { memo, useMemo, useState } from 'react';
import { ROW, buildClaimTree, claimChain, compactRanges } from '../logic/claimTree.ts';
import type { ClaimNode } from '../logic/claimTree.ts';
import type { ClaimGraph } from '../logic/claims.ts';
import type { Strings } from '../i18n.ts';

export interface ClaimTreeProps {
  graph: ClaimGraph;
  /** The buffer the graph was computed from. */
  text: string;
  t: Strings;
  /** Select a span in the editor — the claim's number. */
  onJump: (start: number, end: number) => void;
}

// ── CLAIM TREE ──────────────────────────────────────────────────────────────
// Claims mode only. The dependency graph as an arc diagram (see
// logic/claimTree.ts for why arcs): each claim a row in document order, each
// reference an arc on the left. Pointing at a claim — mouse or keyboard —
// lights the claims it rests on and the ones resting on it; clicking jumps to
// it in the text.
//
// The rows are real buttons laid over the SVG, so the graph is reachable and
// readable without it: each row's accessible name spells out its parents.
//
// Loaded lazily (LazyClaimTree), layout included: only claims mode draws it.
function ClaimTreeImpl({ graph, text, t, onJump }: ClaimTreeProps) {
  const tree = useMemo(() => buildClaimTree(graph, text), [graph, text]);
  // Hover and focus are tracked apart: a click moves focus into the editor,
  // and the chain under the pointer should not go dark with it.
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const active = hover ?? focused;
  // An edit can delete the claim under the pointer; nothing is lit then.
  const chain = useMemo(
    () =>
      active !== null && tree?.nodes.some((n) => n.num === active)
        ? claimChain(tree, active)
        : null,
    [tree, active]
  );
  if (!tree) return null;

  // SVG paints in document order, so the lit arcs go last to sit on top.
  const arcs = tree.edges.map((e, i) => ({ e, on: !!chain?.edges.has(i) }));
  arcs.sort((a, b) => Number(a.on) - Number(b.on));

  const describe = (n: ClaimNode) =>
    t.ctNode(n.num, compactRanges(n.parents)) +
    (n.bad ? `, ${t.ctBad}` : '') +
    (n.label ? `: ${n.label}` : '');

  const kinds = new Set(tree.nodes.map((n) => n.kind));
  const key: [string, string][] = [
    ['ct-independent', t.ctIndep],
    ['ct-dependent', t.ctDep],
  ];
  if (kinds.has('multiple')) key.push(['ct-multiple', t.ctMulti]);
  if (tree.nodes.some((n) => n.bad)) key.push(['ct-dependent bad', t.ctBad]);

  return (
    <div className="ct-body">
      <div
        className={chain ? 'ct-graph hl' : 'ct-graph'}
        style={{ height: tree.height }}
        onMouseLeave={() => setHover(null)}
      >
        <svg className="ct-arcs" width={tree.width} height={tree.height} aria-hidden="true">
          {arcs.map(({ e, on }) => (
            <path key={`${e.from}>${e.to}`} className={on ? 'on' : undefined} d={e.d} />
          ))}
        </svg>
        {tree.nodes.map((n) => {
          const label = describe(n);
          const lit = chain?.nodes.has(n.num);
          return (
            <button
              type="button"
              key={n.num}
              className={`ct-row${lit ? ' on' : ''}${n.num === active ? ' cur' : ''}`}
              style={{ height: ROW, paddingLeft: tree.nodeX }}
              title={label}
              aria-label={label}
              onMouseEnter={() => setHover(n.num)}
              onFocus={() => setFocused(n.num)}
              onBlur={() => setFocused(null)}
              onClick={() => onJump(n.start, n.end)}
            >
              <span className={`ct-node ct-${n.kind}${n.bad ? ' bad' : ''}`}>{n.num}</span>
              {n.label && <span className="ct-lbl">{n.label}</span>}
            </button>
          );
        })}
      </div>
      <div className="ct-key" aria-hidden="true">
        {key.map(([cls, word]) => (
          <span key={cls}>
            <span className={`ct-node ct-swatch ${cls}`} />
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}

// memo: the graph only changes with the claims text, and hovering inside it is
// local state — the rest of the sidebar never re-renders this.
export const ClaimTree = memo(ClaimTreeImpl);
