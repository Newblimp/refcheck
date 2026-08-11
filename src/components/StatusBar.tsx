import { memo } from 'react';
import { ERROR_KINDS } from '../logic/errorKinds.ts';
import { ChevronLeftIcon, ChevronRightIcon } from './icons.tsx';
import type { JSX } from 'preact';
import type { ErrorKindId, ErrorRecord } from '../logic/errorKinds.ts';
import type { Mode } from '../logic/constants.ts';
import type { Strings } from '../i18n.ts';

// ── STATUS BAR ──────────────────────────────────────────────────────────────
// The counts under the editor, the prev/next error stepper, the restore-all
// button and the claims-mode reminder.
//
// One chip per error category, produced from ERROR_KINDS — so a new category
// appears here for free.

interface ChipProps {
  count: number;
  /** CSS token base: `var(--<color>)`. */
  color: string;
  label: string;
  style?: JSX.CSSProperties;
}

const Chip = ({ count, color, label, style }: ChipProps) =>
  count > 0 && (
    <div className="s-chip" style={{ color: `var(--${color})`, ...style }}>
      <span className="s-dot" style={{ background: `var(--${color})` }} />
      {count} {label}
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
      {totalSigns > 0 && !anyActive && (
        <div className="s-chip" style={{ color: 'var(--ok)' }}>
          <span className="s-dot" style={{ background: 'var(--ok)' }} />
          {t.allConsistent}
        </div>
      )}
      {errorCount > 0 && (
        <div className="err-nav" style={{ marginLeft: 'auto' }}>
          <button
            className="nav-btn"
            onClick={() => onNavigate(-1)}
            aria-label={t.navPrev}
            title={t.navPrev}
          >
            <ChevronLeftIcon />
          </button>
          <span className="nav-lbl">{t.navLabel(navIdx + 1, errorCount)}</span>
          <button
            className="nav-btn"
            onClick={() => onNavigate(1)}
            aria-label={t.navNext}
            title={t.navNext}
          >
            <ChevronRightIcon />
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
