import { memo } from 'react';

// ── CLAIM-SET STATISTICS ────────────────────────────────────────────────────
// Claims mode only. Counts plus the fee/practice thresholds a drafter checks
// before filing — see logic/claimStats.js for why these particular numbers.
function ClaimStatsImpl({ stats, t }) {
  if (!stats) return null;

  // Nothing in this panel is a validation error — a multiply-dependent claim is
  // a legitimate drafting choice with a fee attached, not a mistake. So these
  // read as information (ⓘ) rather than borrowing the warning triangle the real
  // error cards use, which would otherwise imply something needs fixing.
  const notes = [];
  if (stats.multipleDependent.length) notes.push(t.csMultiple(stats.multipleDependent));
  if (stats.dependsOnMultiple.length) notes.push(t.csOnMultiple(stats.dependsOnMultiple));
  for (const flag of stats.flags) {
    if (flag === 'dpmaExcessClaims') notes.push(t.csDpmaExcess(stats.total));
    else if (flag === 'epoExcessClaims') notes.push(t.csEpoExcess(stats.total));
    else if (flag === 'epoHighExcessClaims') notes.push(t.csEpoHighExcess(stats.total));
  }

  const cell = (n, label, warn) => (
    <div className="stat-cell">
      <span className="stat-n" style={{ color: warn ? 'var(--warn)' : 'var(--text)' }}>
        {n}
      </span>
      <span className="stat-l">{label}</span>
    </div>
  );

  return (
    <div className="cs-body">
      <div className="stats-row">
        {cell(stats.total, t.csTotal)}
        {cell(stats.independent, t.csIndep)}
        {cell(stats.dependent, t.csDepend)}
        {cell(stats.maxDepth, t.csDepth)}
      </div>
      {notes.map((n) => (
        <div className="cs-note" key={n}>
          <span className="cs-note-icon" aria-hidden="true">
            ⓘ
          </span>
          {n}
        </div>
      ))}
    </div>
  );
}

export const ClaimStats = memo(ClaimStatsImpl);
