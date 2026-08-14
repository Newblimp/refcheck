import { memo } from 'react';
import { StatCell } from './StatCell.tsx';
import type { ClaimStats as ClaimStatsData } from '../logic/claimStats.ts';
import type { Strings } from '../i18n.ts';

export interface ClaimStatsProps {
  stats: ClaimStatsData | null;
  t: Strings;
}

// ── CLAIM-SET STATISTICS ────────────────────────────────────────────────────
// Claims mode only. Counts plus the fee/practice thresholds a drafter checks
// before filing — see logic/claimStats.js for why these particular numbers.
function ClaimStatsImpl({ stats, t }: ClaimStatsProps) {
  if (!stats) return null;

  // Nothing in this panel is a validation error — a multiply-dependent claim is
  // a legitimate drafting choice with a fee attached, not a mistake. So these
  // read as information (ⓘ) rather than borrowing the warning triangle the real
  // error cards use, which would otherwise imply something needs fixing.
  const notes: string[] = [];
  if (stats.multipleDependent.length) notes.push(t.csMultiple(stats.multipleDependent));
  if (stats.dependsOnMultiple.length) notes.push(t.csOnMultiple(stats.dependsOnMultiple));
  for (const flag of stats.flags) {
    if (flag === 'dpmaExcessClaims') notes.push(t.csDpmaExcess(stats.total));
    else if (flag === 'epoExcessClaims') notes.push(t.csEpoExcess(stats.total));
    else if (flag === 'epoHighExcessClaims') notes.push(t.csEpoHighExcess(stats.total));
  }

  return (
    <div className="cs-body">
      <div className="stats-row">
        <StatCell n={stats.total} label={t.csTotal} />
        <StatCell n={stats.independent} label={t.csIndep} />
        <StatCell n={stats.dependent} label={t.csDepend} />
        <StatCell n={stats.maxDepth} label={t.csDepth} />
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
