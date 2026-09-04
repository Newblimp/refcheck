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
  /** Jump to a sign's occurrences — or, with a term, only those written with it. */
  onFocusSign: (sign: string, termStem?: string) => void;
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
  // Which term chip the focus sits on, for a given card: a sign focus may name
  // one of the sign's terms (the chips cycle that term alone).
  const chipFocus = (sign: string): string | null =>
    focus?.type === 'sign' && focus.key === sign ? (focus.term ?? null) : null;
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
  // The three sign sections differ only in their list and header — and a
  // dismissed sign's card never shows as the focused one.
  const signSection = (
    icon: string,
    label: string,
    color: string,
    list: [string, SignEntry][],
    focusable = true
  ) => (
    <Section icon={icon} label={label} color={color} count={list.length}>
      {list.map(([sign, sData]) => (
        <SignCard
          key={sign}
          sign={sign}
          sData={sData}
          focused={focusable && focus?.type === 'sign' && focus.key === sign}
          focusedTerm={chipFocus(sign)}
          {...signCardProps}
        />
      ))}
    </Section>
  );

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
            title={t.searchHint}
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
            {signSection('⚠', t.gErr, 'var(--warn)', errSignsActive)}
            {/* Article errors, missing signs, claim numbering, claim
                dependencies — in ERROR_KINDS order. */}
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
            {signSection('✓', t.gOk, 'var(--ok)', okSigns)}
            {signSection('↩', t.gDis, 'var(--text-dim)', errSignsDismissed, false)}
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
                count={Object.values(orphaned).reduce((n, l) => n + l.length, 0)}
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
                {(
                  [
                    ['od', orphaned.missingInDesc, t.missingInDesc],
                    ['oc', orphaned.missingInClaims, t.missingInClaims],
                    ['ni', orphaned.notIntroducedInDesc, t.notIntroducedInDesc],
                  ] as const
                ).map(([prefix, signs, msg]) =>
                  signs.map((s) => (
                    <OrphanCard key={prefix + s} label={s}>
                      {msg}
                    </OrphanCard>
                  ))
                )}
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
