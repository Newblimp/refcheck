import { SignCard } from './SignCard.jsx';
import { ArtCard } from './ArtCard.jsx';
import { BareCard } from './BareCard.jsx';
import { NumCard } from './NumCard.jsx';
import { DepCard } from './DepCard.jsx';
import { RefList } from './RefList.jsx';

// ── SIDEBAR (overview pane) ─────────────────────────────────────────────────
// Purely presentational: App owns all state and the search/dismissal filtering;
// this renders the stats, the search box and the card sections.
export function Sidebar({
  t, lang, mode, signData, termData, search, onSearch,
  errSignsActive, errSignsDismissed, okSigns,
  visArtActive, visBareActive, visNumActive, visDepActive,
  focus, dis, disCt, mwo, hoverSign, onHover,
  onFocusSign, onFocusArt, onFocusBare, onFocusNum, onFocusDep,
  onDismiss, onRestoreAll, orphaned,
}) {
  const totalSigns = Object.keys(signData).length;
  const totalErrs = errSignsActive.length + visArtActive.length + visBareActive.length +
    visNumActive.length + visDepActive.length;
  const signCardProps = { termData, mode, t, lang, dis, mwo, onFocus: onFocusSign, onDismiss, hoverSign, onHover };

  return (
    <div className="ov-pane">
      <div className="pane-hdr"><span className="pane-title">{t.ovLbl}</span></div>
      {totalSigns > 0 && <div className="stats-row">
        <div className="stat-cell"><span className="stat-n" style={{ color: 'var(--text)' }}>{totalSigns}</span><span className="stat-l">{t.totalLbl}</span></div>
        <div className="stat-cell"><span className="stat-n" style={{ color: totalErrs > 0 ? 'var(--warn)' : 'var(--text-dim)' }}>{totalErrs}</span><span className="stat-l">{t.errLbl}</span></div>
        <div className="stat-cell"><span className="stat-n" style={{ color: okSigns.length > 0 ? 'var(--ok)' : 'var(--text-dim)' }}>{okSigns.length}</span><span className="stat-l">{t.okLbl}</span></div>
      </div>}
      {totalSigns > 0 && <div className="search-row">
        <input className="search-in" placeholder={t.searchPh} value={search} onChange={e => onSearch(e.target.value)} />
      </div>}
      <div className="ov-scroll">
        {totalSigns === 0 ? (
          <div className="ov-empty">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" />
            </svg>
            <p><strong style={{ color: 'var(--text-muted)' }}>{t.emptyTitle}</strong><br />{t.emptyBody}</p>
          </div>
        ) : (
          <>
            {errSignsActive.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--warn)' }}>⚠ {t.gErr}</div>
              {errSignsActive.map(([sign, sData]) => (
                <SignCard key={sign} sign={sign} sData={sData} focused={focus?.type === 'sign' && focus.key === sign} {...signCardProps} />
              ))}
            </>}
            {visArtActive.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--art)' }}>◈ {t.gArt}</div>
              {visArtActive.map((ae, i) => (
                <ArtCard key={i} ae={ae} focused={focus?.type === 'art' && focus.key === ae.artStart}
                  t={t} dis={dis} onFocus={onFocusArt} onDismiss={onDismiss} />
              ))}
            </>}
            {visBareActive.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--bare)' }}>∅ {t.gBare}</div>
              {visBareActive.map((bt, i) => (
                <BareCard key={i} bt={bt} focused={focus?.type === 'bare' && focus.key === bt.termStart}
                  t={t} dis={dis} onFocus={onFocusBare} onDismiss={onDismiss} />
              ))}
            </>}
            {visNumActive.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--num)' }}>⌗ {t.numberingLbl}</div>
              {visNumActive.map((ne, i) => (
                <NumCard key={i} ne={ne} focused={focus?.type === 'num' && focus.key === ne.start}
                  t={t} dis={dis} onFocus={onFocusNum} onDismiss={onDismiss} />
              ))}
            </>}
            {visDepActive.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--dep)' }}>↷ {t.gDep}</div>
              {visDepActive.map((de, i) => (
                <DepCard key={i} de={de} focused={focus?.type === 'dep' && focus.key === de.start}
                  t={t} dis={dis} onFocus={onFocusDep} onDismiss={onDismiss} />
              ))}
            </>}
            {okSigns.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--ok)' }}>✓ {t.gOk}</div>
              {okSigns.map(([sign, sData]) => (
                <SignCard key={sign} sign={sign} sData={sData} focused={focus?.type === 'sign' && focus.key === sign} {...signCardProps} />
              ))}
            </>}
            {errSignsDismissed.length > 0 && <>
              <div className="sec-lbl" style={{ color: 'var(--text-dim)' }}>↩ {t.gDis}</div>
              {errSignsDismissed.map(([sign, sData]) => (
                <SignCard key={sign} sign={sign} sData={sData} focused={false} {...signCardProps} />
              ))}
            </>}
            {disCt > 0 && <div className="dis-section">
              <div className="dis-hdr">
                <span>↩ {t.disCt(disCt)}</span>
                <button className="ra-btn" onClick={onRestoreAll}>{t.restoreAll}</button>
              </div>
            </div>}
            {orphaned && <>
              <div className="sec-lbl" style={{ color: 'var(--text-muted)' }}>⇄ {t.crossRefLbl}</div>
              {orphaned.signConflicts.map(({ sign, descTerms, claimsTerms }) => (
                <div className="orphan-card" key={'sc' + sign}>
                  <span className="orphan-sign">{sign}</span>
                  <span className="orphan-msg">{t.crossSignConflict(descTerms[0] || '?', claimsTerms[0] || '?')}</span>
                </div>
              ))}
              {orphaned.termConflicts.map(({ ts, rawTerm, descSigns, claimsSigns }) => (
                <div className="orphan-card" key={'tc' + ts}>
                  <span className="orphan-sign">"{rawTerm}"</span>
                  <span className="orphan-msg">{t.crossTermConflict(descSigns.join('/'), claimsSigns.join('/'))}</span>
                </div>
              ))}
              {orphaned.missingInDesc.map(s => (
                <div className="orphan-card" key={'od' + s}>
                  <span className="orphan-sign">{s}</span>
                  <span className="orphan-msg">{t.missingInDesc}</span>
                </div>
              ))}
              {orphaned.missingInClaims.map(s => (
                <div className="orphan-card" key={'oc' + s}>
                  <span className="orphan-sign">{s}</span>
                  <span className="orphan-msg">{t.missingInClaims}</span>
                </div>
              ))}
              {orphaned.notIntroducedInDesc.map(s => (
                <div className="orphan-card" key={'ni' + s}>
                  <span className="orphan-sign">{s}</span>
                  <span className="orphan-msg">{t.notIntroducedInDesc}</span>
                </div>
              ))}
            </>}
            <RefList signData={signData} termData={termData} t={t} lang={lang} />
          </>
        )}
      </div>
    </div>
  );
}
