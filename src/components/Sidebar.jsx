import { memo } from 'react';
import { SignCard } from './SignCard.jsx';
import { ErrorCard } from './ErrorCard.jsx';
import { ClaimStats } from './ClaimStats.jsx';
import { Section } from './Section.jsx';
import { EmptyDocIcon } from './icons.jsx';
import { ERROR_KINDS } from '../logic/errorKinds.ts';

// ── SIDEBAR (overview pane) ─────────────────────────────────────────────────
// Purely presentational: App owns all state and the search/dismissal filtering;
// this renders the stats, the search box and the card sections.
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
}) {
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
          <div className="stat-cell">
            <span className="stat-n" style={{ color: 'var(--text)' }}>
              {totalSigns}
            </span>
            <span className="stat-l">{t.totalLbl}</span>
          </div>
          <div className="stat-cell">
            <span
              className="stat-n"
              style={{ color: totalErrs > 0 ? 'var(--warn)' : 'var(--text-dim)' }}
            >
              {totalErrs}
            </span>
            <span className="stat-l">{t.errLbl}</span>
          </div>
          <div className="stat-cell">
            <span
              className="stat-n"
              style={{ color: okSigns.length > 0 ? 'var(--ok)' : 'var(--text-dim)' }}
            >
              {okSigns.length}
            </span>
            <span className="stat-l">{t.okLbl}</span>
          </div>
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
            onChange={(e) => onSearch(e.target.value)}
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
                  <div className="orphan-card" key={'sc' + sign}>
                    <span className="orphan-sign">{sign}</span>
                    <span className="orphan-msg">
                      {t.crossSignConflict(descTerms[0] || '?', claimsTerms[0] || '?')}
                    </span>
                  </div>
                ))}
                {orphaned.termConflicts.map(({ ts, rawTerm, descSigns, claimsSigns }) => (
                  <div className="orphan-card" key={'tc' + ts}>
                    <span className="orphan-sign">"{rawTerm}"</span>
                    <span className="orphan-msg">
                      {t.crossTermConflict(descSigns.join('/'), claimsSigns.join('/'))}
                    </span>
                  </div>
                ))}
                {orphaned.missingInDesc.map((s) => (
                  <div className="orphan-card" key={'od' + s}>
                    <span className="orphan-sign">{s}</span>
                    <span className="orphan-msg">{t.missingInDesc}</span>
                  </div>
                ))}
                {orphaned.missingInClaims.map((s) => (
                  <div className="orphan-card" key={'oc' + s}>
                    <span className="orphan-sign">{s}</span>
                    <span className="orphan-msg">{t.missingInClaims}</span>
                  </div>
                ))}
                {orphaned.notIntroducedInDesc.map((s) => (
                  <div className="orphan-card" key={'ni' + s}>
                    <span className="orphan-sign">{s}</span>
                    <span className="orphan-msg">{t.notIntroducedInDesc}</span>
                  </div>
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
