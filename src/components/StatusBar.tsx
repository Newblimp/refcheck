import { memo } from 'react';
import { ERROR_KINDS } from '../logic/errorKinds.ts';
import { ChevronIcon } from './icons.tsx';
import type { ErrorKindId, ErrorRecord } from '../logic/errorKinds.ts';
import type { Mode } from '../logic/constants.ts';
import type { Strings } from '../i18n.ts';

// ── STATUS BAR ──────────────────────────────────────────────────────────────
// The counts under the editor, the prev/next error stepper, the restore-all
// button and the claims-mode reminder.
//
// One chip per error category, produced from ERROR_KINDS — so a new category
// appears here for free.

/** One coloured count in the bar; a chip with no count is a plain statement. */
const Chip = ({ count, color, label }: { count?: number; color: string; label: string }) =>
  count !== 0 && (
    <div className="s-chip" style={{ color: `var(--${color})` }}>
      <span className="s-dot" style={{ background: `var(--${color})` }} />
      {count === undefined ? label : `${count} ${label}`}
    </div>
  );

export interface StatusBarProps {
  t: Strings;
  mode: Mode;
  hasText: boolean;
  signErrCount: number;
  /** Active (non-dismissed) records per category id. */
  errorLists: Record<ErrorKindId, ErrorRecord[]>;
  totalSigns: number;
  anyActive: boolean;
  errorCount: number;
  navIdx: number;
  onNavigate: (delta: number) => void;
  disCt: number;
  onRestoreAll: () => void;
}

function StatusBarImpl({
  t,
  mode,
  hasText,
  signErrCount,
  errorLists,
  totalSigns,
  anyActive,
  errorCount,
  navIdx,
  onNavigate,
  disCt,
  onRestoreAll,
}: StatusBarProps) {
  return (
    <div className="statusbar">
      <Chip count={signErrCount} color="warn" label={t.errLbl} />
      {ERROR_KINDS.map((k) => (
        <Chip key={k.id} count={errorLists[k.id].length} color={k.color} label={t[k.chipLbl]} />
      ))}
      {/* Only worth saying once there are signs to be consistent about. */}
      {totalSigns > 0 && !anyActive && <Chip color="ok" label={t.allConsistent} />}
      {errorCount > 0 && (
        <div className="err-nav" style={{ marginLeft: 'auto' }}>
          <button
            className="nav-btn"
            onClick={() => onNavigate(-1)}
            aria-label={t.navPrev}
            title={t.navPrev}
          >
            <ChevronIcon left />
          </button>
          <span className="nav-lbl">{t.navLabel(navIdx + 1, errorCount)}</span>
          <button
            className="nav-btn"
            onClick={() => onNavigate(1)}
            aria-label={t.navNext}
            title={t.navNext}
          >
            <ChevronIcon />
          </button>
        </div>
      )}
      {disCt > 0 && (
        <button className="restore-btn" onClick={onRestoreAll}>
          ↩ {t.restoreAll} ({disCt})
        </button>
      )}
      {mode === 'claims' && hasText && (
        <div className="s-chip" style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
          {t.claimsNote}
        </div>
      )}
    </div>
  );
}

export const StatusBar = memo(StatusBarImpl);
