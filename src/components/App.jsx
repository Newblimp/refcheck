import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { T } from '../i18n.js';
import { extractData, classify, getAllErrors } from '../logic/extract.js';
import { buildHtml, findAtPos } from '../logic/buildHtml.js';
import { computeCrossRef } from '../logic/crossref.js';
import { compareSigns, disKey } from '../logic/constants.js';
import { stem } from '../logic/stem.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { usePersistentState, jsonCodec, setCodec, oneOf } from '../hooks/usePersistentState.js';
import { useTheme } from '../hooks/useTheme.js';
import { CtxMenu } from './CtxMenu.jsx';
import { Sidebar } from './Sidebar.jsx';

const EMPTY_RESULT = { signData: {}, termData: {}, artErrors: [], bareTerms: [], numErrors: [], depErrors: [], noTermSigns: new Set() };

// ── APP ─────────────────────────────────────────────────────────────────────
export function App() {
  // Persisted preferences and buffers (all survive a refresh; see CLAUDE.md for keys)
  const [lang, setLang] = usePersistentState('rsc_lang', 'en', oneOf(['en', 'de'], 'en'));
  const [mode, setMode] = usePersistentState('rsc_mode', 'description', oneOf(['description', 'claims'], 'description'));
  const [descText, setDescText] = usePersistentState('rsc_desc', '');
  const [claimsText, setClaimsText] = usePersistentState('rsc_claims', '');
  const [mwo, setMwo] = usePersistentState('rsc_mwo', {}, jsonCodec);
  const [dis, setDis] = usePersistentState('rsc_dis', new Set(), setCodec);
  const [theme, setTheme] = useTheme();
  // Transient UI state
  const text = mode === 'description' ? descText : claimsText;
  const [hoverSign, setHoverSign] = useState(null);
  // Currently highlighted error card: {type: 'sign'|'art'|'bare'|'num'|'dep', key}
  // (key = sign string for signs, char position for everything else).
  const [focus, setFocus] = useState(null);
  const [search, setSearch] = useState('');
  const [navIdx, setNavIdx] = useState(0);
  const [ctx, setCtx] = useState(null);
  const bdRef = useRef(null), taRef = useRef(null);
  const t = T[lang];

  // Debounce the expensive extraction on large documents; the textarea value
  // stays immediate so typing is never blocked.
  const debDesc = useDebounced(descText, descText.length > 5000 ? 200 : 0);
  const debClaims = useDebounced(claimsText, claimsText.length > 5000 ? 200 : 0);
  const debText = mode === 'description' ? debDesc : debClaims;
  const descResult = useMemo(() => debDesc ? extractData(debDesc, lang, mwo, true, false) : null, [debDesc, lang, mwo]);
  const claimsResult = useMemo(() => debClaims ? extractData(debClaims, lang, mwo, true, true) : null, [debClaims, lang, mwo]);
  const res = (mode === 'description' ? descResult : claimsResult) ?? EMPTY_RESULT;
  const { signData, termData, artErrors, bareTerms, numErrors, depErrors } = res;

  const orphaned = useMemo(() => computeCrossRef(descResult, claimsResult), [descResult, claimsResult]);

  const allErrors = useMemo(() => getAllErrors(res, mode, dis), [res, mode, dis]);

  useEffect(() => setNavIdx(0), [allErrors.length]);

  const focusSign = focus?.type === 'sign' ? focus.key : null;
  const html = useMemo(() => buildHtml(debText, res, mode, dis, focusSign), [debText, res, mode, dis, focusSign]);

  const syncScroll = useCallback(() => { if (taRef.current && bdRef.current) bdRef.current.scrollTop = taRef.current.scrollTop; }, []);

  // Editor hover → sidebar-card highlight. elementFromPoint forces a synchronous
  // hit-test, so throttle to one lookup per animation frame instead of running
  // it on every mousemove.
  const hoverPending = useRef(false);
  const handleEditorHover = useCallback(e => {
    if (hoverPending.current) return;
    hoverPending.current = true;
    const x = e.clientX, y = e.clientY;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : cb => setTimeout(cb, 16);
    raf(() => {
      hoverPending.current = false;
      const ta = taRef.current;
      if (!ta) return;
      ta.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      ta.style.pointerEvents = '';
      const sign = el?.dataset?.sign || el?.closest?.('[data-sign]')?.dataset?.sign || null;
      setHoverSign(prev => prev === sign ? prev : sign);
    });
  }, []);

  useEffect(() => {
    const bd = bdRef.current;
    if (!bd) return;
    bd.querySelectorAll('mark[data-sign]').forEach(m => {
      m.classList.toggle('h-hover', m.dataset.sign === hoverSign);
    });
  }, [hoverSign, html]);

  // ── Search-filtered card lists (also drive the status-bar chips) ──
  const { errSigns, okSigns } = useMemo(() => {
    const q = search.toLowerCase(), err = [], ok = [];
    for (const [sign, sData] of Object.entries(signData)) {
      if (q && !sign.toLowerCase().includes(q)) {
        const termMatch = Object.keys(sData.terms).some(ts =>
          [...(termData[ts]?.rawTerms || [])].some(r => r.includes(q)));
        if (!termMatch) continue;
      }
      (classify(sign, sData, termData, mode) === 'warn' ? err : ok).push([sign, sData]);
    }
    const byN = ([a], [b]) => compareSigns(a, b);
    return { errSigns: err.sort(byN), okSigns: ok.sort(byN) };
  }, [signData, termData, mode, search]);

  const visArt = useMemo(() => { const q = search.toLowerCase(); return artErrors.filter(ae => !q || ae.termStem.includes(q) || [...(termData[ae.termStem]?.rawTerms || [])].some(r => r.includes(q))); }, [artErrors, termData, search]);
  const visArtActive = visArt.filter(ae => !dis.has(disKey.art(ae.termStem)));
  const visBare = useMemo(() => { const q = search.toLowerCase(); return bareTerms.filter(bt => !q || bt.term.includes(q) || bt.termStem.includes(q)); }, [bareTerms, search]);
  const visBareActive = visBare.filter(bt => !dis.has(disKey.bare(bt.termStem)));
  const visNum = useMemo(() => { const q = search.toLowerCase(); return numErrors.filter(ne => !q || String(ne.value).includes(q) || String(ne.expected).includes(q)); }, [numErrors, search]);
  const visNumActive = visNum.filter(ne => !dis.has(disKey.num(ne.key)));
  const visDep = useMemo(() => { const q = search.toLowerCase(); return depErrors.filter(de => !q || String(de.claim).includes(q) || String(de.ref).includes(q)); }, [depErrors, search]);
  const visDepActive = visDep.filter(de => !dis.has(disKey.dep(de.key)));
  const errSignsActive = errSigns.filter(([s]) => !dis.has(disKey.sign(s)));
  const errSignsDismissed = errSigns.filter(([s]) => dis.has(disKey.sign(s)));
  const disCt = dis.size;
  const totalSigns = Object.keys(signData).length;
  const anyActive = errSignsActive.length || visArtActive.length || visBareActive.length || visNumActive.length || visDepActive.length;

  function scrollTo(start, end) {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    // Measure the real line height instead of hardcoding it, so CSS changes and
    // browser zoom cannot desync click-to-navigate scrolling.
    let lh = parseFloat(getComputedStyle(ta).lineHeight);
    if (!Number.isFinite(lh)) lh = (parseFloat(getComputedStyle(ta).fontSize) || 13.5) * 1.75;
    const lines = text.slice(0, start).split('\n').length;
    ta.scrollTop = Math.max(0, (lines - 5) * lh);
    syncScroll();
  }

  // Toggle focus on a card and jump the editor to its span.
  function focusItem(type, key, start, end) {
    setFocus(f => (f && f.type === type && f.key === key) ? null : { type, key });
    if (start !== undefined) scrollTo(start, end);
  }
  const onFocusSign = sign => {
    const p = signData[sign]?.positions[0];
    setFocus(f => (f && f.type === 'sign' && f.key === sign) ? null : { type: 'sign', key: sign });
    if (p) scrollTo(p.signStart, p.signEnd);
  };
  const onFocusArt = ae => focusItem('art', ae.artStart, ae.artStart, ae.artEnd);
  const onFocusBare = bt => focusItem('bare', bt.termStart, bt.termStart, bt.termEnd);
  const onFocusNum = ne => focusItem('num', ne.start, ne.start, ne.end);
  const onFocusDep = de => focusItem('dep', de.start, de.start, de.end);

  function navigate(dir) {
    if (!allErrors.length) return;
    const next = (navIdx + dir + allErrors.length) % allErrors.length;
    setNavIdx(next);
    const e = allErrors[next];
    scrollTo(e.start, e.end);
    setFocus({ type: e.type, key: e.type === 'sign' ? e.sign : e.start });
  }

  function toggleDis(key) { setDis(d => { const n = new Set(d); n.has(key) ? n.delete(key) : n.add(key); return n; }); }
  function disAll() {
    const k = new Set();
    Object.keys(signData).forEach(s => k.add(disKey.sign(s)));
    artErrors.forEach(ae => k.add(disKey.art(ae.termStem)));
    bareTerms.forEach(bt => k.add(disKey.bare(bt.termStem)));
    numErrors.forEach(ne => k.add(disKey.num(ne.key)));
    depErrors.forEach(de => k.add(disKey.dep(de.key)));
    setDis(k);
  }
  function restoreAll() { setDis(new Set()); }

  function handleCtxMenu(e) {
    e.preventDefault();
    const pos = taRef.current?.selectionStart ?? 0;
    const found = findAtPos(pos, signData, artErrors);
    if (!found) return;
    const items = [];
    if (found.type === 'sign') {
      const { sign, pos: p } = found;
      const bs = stem(p.term.split(' ').pop(), lang);
      const cur = 1 + (mwo[bs] || 0);
      items.push({ label: t.extendTerm(cur), a: 'extend', d: { bs } });
      if (cur > 1) items.push({ label: t.reduceTerm, a: 'reduce', d: { bs } });
      items.push({ sep: true });
      const isDis = dis.has(disKey.sign(sign));
      items.push({ label: isDis ? `↩ Restore "${sign}"` : t.disSign(sign), a: 'toggle-dis', d: { key: disKey.sign(sign) } });
    } else {
      const { ae } = found;
      const isDis = dis.has(disKey.art(ae.termStem));
      items.push({ label: isDis ? `↩ Restore article` : t.disArt(ae.termStem), a: 'toggle-dis', d: { key: disKey.art(ae.termStem) } });
    }
    items.push({ sep: true });
    items.push({ label: t.disAll, a: 'dis-all', v: 'warn' });
    if (disCt) items.push({ label: `↩ ${t.restoreAll} (${disCt})`, a: 'restore-all' });
    setCtx({ x: e.clientX, y: e.clientY, items, label: found.type === 'sign' ? `Sign ${found.sign}` : `Article: ${found.ae?.article}` });
  }

  function handleCtxAction(a, d) {
    if (a === 'extend') setMwo(m => ({ ...m, [d.bs]: (m[d.bs] || 0) + 1 }));
    else if (a === 'reduce') setMwo(m => { const n = { ...m }; n[d.bs] > 1 ? n[d.bs]-- : delete n[d.bs]; return n; });
    else if (a === 'toggle-dis') toggleDis(d.key);
    else if (a === 'dis-all') disAll();
    else if (a === 'restore-all') restoreAll();
  }

  function doReset() {
    if (typeof window !== 'undefined' && !window.confirm(t.resetConfirm)) return;
    setDis(new Set());
    setMwo({});
    setDescText('');
    setClaimsText('');
  }

  const chip = (count, color, label) => count > 0 && (
    <div className="s-chip" style={{ color: `var(--${color})` }}>
      <span className="s-dot" style={{ background: `var(--${color})` }} />{count} {label}
    </div>
  );

  return (<>
    {ctx && <CtxMenu menu={ctx} onClose={() => setCtx(null)} onAction={handleCtxAction} />}

    <div className="topbar">
      <div className="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" />
        </svg>
        <span>RefSign<em> Checker</em></span>
      </div>
      <div className="spacer" />
      <div className="theme-toggle">
        <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Light</button>
        <button className={theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')}>System</button>
        <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Dark</button>
      </div>
      <div className="pill-toggle">
        <button className={mode === 'description' ? 'active' : ''} onClick={() => { setMode('description'); setFocus(null); }}>{t.modeDesc}{descText && <span className="buf-dot" />}</button>
        <button className={mode === 'claims' ? 'active' : ''} onClick={() => { setMode('claims'); setFocus(null); }}>{t.modeClaims}{claimsText && <span className="buf-dot" />}</button>
      </div>
      <div className="lang-toggle">
        <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
        <button className={lang === 'de' ? 'active' : ''} onClick={() => setLang('de')}>DE</button>
      </div>
    </div>

    <div className="main">
      <div className="editor-pane">
        <div className="pane-hdr">
          <span className="pane-title">{t.editorLbl}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{t.charCount(text.length)}</span>
        </div>
        <div className="editor-wrap" onMouseMove={handleEditorHover} onMouseLeave={() => setHoverSign(null)}>
          <div className="backdrop" ref={bdRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
          <textarea className="editor-ta" ref={taRef} value={text}
            placeholder={mode === 'description' ? t.placeholder_desc : t.placeholder_claims}
            onChange={e => { mode === 'description' ? setDescText(e.target.value) : setClaimsText(e.target.value); setFocus(null); }}
            onScroll={syncScroll} onContextMenu={handleCtxMenu}
            spellCheck={false} autoCorrect="off" autoCapitalize="off" />
        </div>
        <div className="statusbar">
          {chip(errSignsActive.length, 'warn', t.errLbl)}
          {chip(visArtActive.length, 'art', t.artLbl)}
          {chip(visBareActive.length, 'bare', t.bareLbl)}
          {chip(visNumActive.length, 'num', t.numberingLbl)}
          {chip(visDepActive.length, 'dep', t.depLbl)}
          {totalSigns > 0 && !anyActive &&
            <div className="s-chip" style={{ color: 'var(--ok)' }}><span className="s-dot" style={{ background: 'var(--ok)' }} />All consistent</div>}
          {allErrors.length > 0 && <div className="err-nav" style={{ marginLeft: 'auto' }}>
            <button className="nav-btn" onClick={() => navigate(-1)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="nav-lbl">{t.navLabel(navIdx + 1, allErrors.length)}</span>
            <button className="nav-btn" onClick={() => navigate(1)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>}
          {disCt > 0 && <button className="restore-btn" onClick={restoreAll}>↩ {t.restoreAll} ({disCt})</button>}
          {mode === 'claims' && text.length > 0 && <div className="s-chip" style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{t.claimsNote}</div>}
        </div>
      </div>

      <Sidebar t={t} lang={lang} mode={mode} signData={signData} termData={termData}
        search={search} onSearch={setSearch}
        errSignsActive={errSignsActive} errSignsDismissed={errSignsDismissed} okSigns={okSigns}
        visArtActive={visArtActive} visBareActive={visBareActive}
        visNumActive={visNumActive} visDepActive={visDepActive}
        focus={focus} dis={dis} disCt={disCt} mwo={mwo}
        hoverSign={hoverSign} onHover={setHoverSign}
        onFocusSign={onFocusSign} onFocusArt={onFocusArt} onFocusBare={onFocusBare}
        onFocusNum={onFocusNum} onFocusDep={onFocusDep}
        onDismiss={toggleDis} onRestoreAll={restoreAll} orphaned={orphaned} />
    </div>
    <button className="reset-btn" onClick={doReset} title={t.resetAll}>{t.resetAll}</button>
  </>);
}
