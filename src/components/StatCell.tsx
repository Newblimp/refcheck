export interface StatCellProps {
  n: number;
  label: string;
  /** CSS colour for the figure. Defaults to the ordinary text colour. */
  color?: string;
}

// ── STAT CELL ────────────────────────────────────────────────────────────────
// One figure-over-label cell of a .stats-row. Shared by the sidebar's sign
// counts (three across) and the claim-set panel (four, 2×2) — they were the same
// six lines of markup in both, with only the colour rule differing, and the
// colour is the caller's decision either way.
export const StatCell = ({ n, label, color = 'var(--text)' }: StatCellProps) => (
  <div className="stat-cell">
    <span className="stat-n" style={{ color }}>
      {n}
    </span>
    <span className="stat-l">{label}</span>
  </div>
);
