import { memo } from 'react';
import { SignCard } from './SignCard.tsx';
import { ErrorCard } from './ErrorCard.tsx';
import { ClaimStats } from './ClaimStats.tsx';
import { Section } from './Section.tsx';
import { OrphanCard } from './OrphanCard.tsx';
import { StatCell } from './StatCell.tsx';
import { EmptyDocIcon } from './icons.tsx';
import { ERROR_KINDS } from '../logic/errorKinds.ts';
import type { ErrorKindId, ErrorRecord, Focus } from '../logic/errorKinds.ts';
import type { Mode } from '../logic/constants.ts';
import type { SignEntry, TermEntry } from '../logic/extract.ts';
import type { CrossRef } from '../logic/crossref.ts';
import type { ClaimStats as ClaimStatsData } from '../logic/claimStats.ts';
import type { Ref } from 'preact';
import type { Strings } from '../i18n.ts';

// ── SIDEBAR (overview pane) ─────────────────────────────────────────────────
// Purely presentational: App owns all state and the search/dismissal filtering;
// this renders the stats, the search box and the card sections.
export interface SidebarProps {
  t: Strings;
  mode: Mode;
  signData: Record<string, SignEntry>;
  termData: Record<string, TermEntry>;
  search: string;
  onSearch: (value: string) => void;
  searchRef: Ref<HTMLInputElement>;
  /** [sign, data] pairs, already search-filtered by App. */
  errSignsActive: [string, SignEntry][];
  errSignsDismissed: [string, SignEntry][];
  okSigns: [string, SignEntry][];
  /** Per category id, already search- and dismissal-filtered by App. */
  errorLists: Record<ErrorKindId, ErrorRecord[]>;
  focus: Focus | null;
  dis: Set<string>;
  disCt: number;
  hoverSign: string | null;
  onHover: (sign: string | null) => void;
  onFocusSign: (sign: string) => void;
  onFocusError: (id: ErrorKindId, item: ErrorRecord) => void;
  onDismiss: (key: string) => void;
  onRestoreAll: () => void;
  /** Description ↔ Claims comparison; null when there is nothing to report. */
  orphaned: CrossRef | null;
  claimSetStats: ClaimStatsData | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function SidebarImpl({
  t,
  mode,
  signData,
  termData,
  search,
  onSearch,
  searchRef,
  errSignsActive,
  errSignsDismissed,
  okSigns,
  // { art: [...], bare: [...], num: [...], dep: [...] } — already search- and
  // dismissal-filtered by App. One prop rather than one per category, so adding
  // a category adds no plumbing here.
  errorLists,
  focus,
  dis,
  disCt,
  hoverSign,
  onHover,
  onFocusSign,
  onFocusError,
  onDismiss,
  onRestoreAll,
  orphaned,
  claimSetStats,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const totalSigns = Object.keys(signData).length;
  const totalErrs =
    errSignsActive.length + ERROR_KINDS.reduce((n, k) => n + errorLists[k.id].length, 0);
  // The multi-word width now comes off the term itself (see SignCard), so the
  // cards no longer need `mwo` or `lang` — one prop identity fewer that changed
  // on every override edit.
  const signCardProps = {
    termData,
    mode,
    t,
    dis,
    onFocus: onFocusSign,
    onDismiss,
    hoverSign,
    onHover,
  };

  return (
    <aside className="ov-pane" aria-label={t.ovLbl}>
      <div className="pane-hdr">
        <span className="pane-title">{t.ovLbl}</span>
        <button
          className="pane-collapse"
          onClick={onToggleCollapse}
          title={collapsed ? t.paneShowSigns : t.paneHideSigns}
          aria-label={collapsed ? t.paneShowSigns : t.paneHideSigns}
          aria-expanded={!collapsed}
        >
          {collapsed ? '‹' : '›'}
        </button>
      </div>
      {totalSigns > 0 && (
        <div className="stats-row">
          <StatCell n={totalSigns} label={t.totalLbl} />
          <StatCell
            n={totalErrs}
            label={t.errLbl}
            color={totalErrs > 0 ? 'var(--warn)' : 'var(--text-dim)'}
          />
          <StatCell
            n={okSigns.length}
            label={t.okLbl}
            color={okSigns.length > 0 ? 'var(--ok)' : 'var(--text-dim)'}
          />
        </div>
      )}
      {totalSigns > 0 && (
        <div className="search-row">
          <input
            ref={searchRef}
            className="search-in"
            placeholder={t.searchPh}
            aria-label={t.searchPh}
            value={search}
            onChange={(e) => onSearch(e.currentTarget.value)}
          />
        </div>
      )}
      <div className="ov-scroll">
        {totalSigns === 0 ? (
          <div className="ov-empty">
            <EmptyDocIcon />
            <p>
              <strong style={{ color: 'var(--text-muted)' }}>{t.emptyTitle}</strong>
              <br />
              {t.emptyBody}
            </p>
          </div>
        ) : (
          <>
            <Section icon="⚠" label={t.gErr} color="var(--warn)" count={errSignsActive.length}>
              {errSignsActive.map(([sign, sData]) => (
                <SignCard
                  key={sign}
                  sign={sign}
                  sData={sData}
                  focused={focus?.type === 'sign' && focus.key === sign}
                  {...signCardProps}
                />
              ))}
            </Section>
            {/* Article errors, missing signs, claim numbering, claim
                dependencies — in ERROR_KINDS order, which is the order they
                were written in by hand before. */}
            {ERROR_KINDS.map((kind) => (
              <Section
                key={kind.id}
                icon={kind.icon}
                label={t[kind.sectionLbl]}
                color={`var(--${kind.color})`}
                count={errorLists[kind.id].length}
              >
                {errorLists[kind.id].map((item) => (
                  <ErrorCard
                    key={kind.cardKey(item)}
                    kind={kind}
                    item={item}
                    focused={focus?.type === kind.id && focus.key === kind.start(item)}
                    t={t}
                    dis={dis}
                    onFocus={onFocusError}
                    onDismiss={onDismiss}
                  />
                ))}
              </Section>
            ))}
            <Section icon="✓" label={t.gOk} color="var(--ok)" count={okSigns.length}>
              {okSigns.map(([sign, sData]) => (
                <SignCard
                  key={sign}
                  sign={sign}
                  sData={sData}
                  focused={focus?.type === 'sign' && focus.key === sign}
                  {...signCardProps}
                />
              ))}
            </Section>
            <Section
              icon="↩"
              label={t.gDis}
              color="var(--text-dim)"
              count={errSignsDismissed.length}
            >
              {errSignsDismissed.map(([sign, sData]) => (
                <SignCard key={sign} sign={sign} sData={sData} focused={false} {...signCardProps} />
              ))}
            </Section>
            {disCt > 0 && (
              <div className="dis-section">
                <div className="dis-hdr">
                  <span>↩ {t.disCt(disCt)}</span>
                  <button className="ra-btn" onClick={onRestoreAll}>
                    {t.restoreAll}
                  </button>
                </div>
              </div>
            )}
            {orphaned && (
              <Section
                icon="⇄"
                label={t.crossRefLbl}
                color="var(--text-muted)"
                count={
                  orphaned.signConflicts.length +
                  orphaned.termConflicts.length +
                  orphaned.missingInDesc.length +
                  orphaned.missingInClaims.length +
                  orphaned.notIntroducedInDesc.length
                }
              >
                {orphaned.signConflicts.map(({ sign, descTerms, claimsTerms }) => (
                  <OrphanCard key={'sc' + sign} label={sign}>
                    {t.crossSignConflict(descTerms[0] || '?', claimsTerms[0] || '?')}
                  </OrphanCard>
                ))}
                {orphaned.termConflicts.map(({ ts, rawTerm, descSigns, claimsSigns }) => (
                  <OrphanCard key={'tc' + ts} label={`"${rawTerm}"`}>
                    {t.crossTermConflict(descSigns.join('/'), claimsSigns.join('/'))}
                  </OrphanCard>
                ))}
                {orphaned.missingInDesc.map((s) => (
                  <OrphanCard key={'od' + s} label={s}>
                    {t.missingInDesc}
                  </OrphanCard>
                ))}
                {orphaned.missingInClaims.map((s) => (
                  <OrphanCard key={'oc' + s} label={s}>
                    {t.missingInClaims}
                  </OrphanCard>
                ))}
                {orphaned.notIntroducedInDesc.map((s) => (
                  <OrphanCard key={'ni' + s} label={s}>
                    {t.notIntroducedInDesc}
                  </OrphanCard>
                ))}
              </Section>
            )}
            {claimSetStats && (
              <Section
                icon="§"
                label={t.claimStatsLbl}
                color="var(--text-muted)"
                count={claimSetStats.total}
                alwaysShow
              >
                <ClaimStats stats={claimSetStats} t={t} />
              </Section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// memo: Sidebar re-renders whenever App does — every keystroke, every hover,
// every bee frame. Its props are stable identities (App memoizes the filtered
// lists and useCallbacks the handlers), so this actually skips the work.
export const Sidebar = memo(SidebarImpl);
