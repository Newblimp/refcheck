import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { T } from '../i18n.js';
import { extractData, classify, getAllErrors } from '../logic/extract.js';
import { buildHtml, findAtPos } from '../logic/buildHtml.js';
import { computeCrossRef } from '../logic/crossref.js';
import { stem } from '../logic/stem.js';
import { CtxMenu } from './CtxMenu.jsx';
import { SignCard } from './SignCard.jsx';
import { NumCard } from './NumCard.jsx';
import { ArtCard } from './ArtCard.jsx';
import { BareCard } from './BareCard.jsx';

// ── APP ─────────────────────────────────────────────────────────────────────
export function App(){
  const[lang,setLang]=useState('en');
  const[mode,setMode]=useState('description');
  const[descText,setDescText]=useState('');
  const[claimsText,setClaimsText]=useState('');
  const text=mode==='description'?descText:claimsText;
  const[hoverSign,setHoverSign]=useState(null);
  const[focusSign,setFocusSign]=useState(null);
  const[focusArtKey,setFocusArtKey]=useState(null);
  const[focusBareKey,setFocusBareKey]=useState(null);
  const[focusNumKey,setFocusNumKey]=useState(null);
  const[search,setSearch]=useState('');
  const[dis,setDis]=useState(new Set());
  const[mwo,setMwo]=useState(()=>{try{return JSON.parse(localStorage.getItem('rsc_mwo')||'{}')}catch{return{}}});
  const[navIdx,setNavIdx]=useState(0);
  const[ctx,setCtx]=useState(null);
  const[theme,setTheme]=useState(()=>{try{return localStorage.getItem('rsc_theme')||'dark'}catch{return'dark'}});
  const bdRef=useRef(null),taRef=useRef(null);
  const t=T[lang];

  useEffect(()=>{try{localStorage.setItem('rsc_mwo',JSON.stringify(mwo))}catch{};},[mwo]);

  // Theme management
  useEffect(()=>{
    try{localStorage.setItem('rsc_theme',theme)}catch{}
    const applyTheme=(t)=>document.documentElement.setAttribute('data-theme',t);
    if(theme==='system'){
      const mq=window.matchMedia('(prefers-color-scheme: dark)');
      const updateSystemTheme=()=>applyTheme(mq.matches?'dark':'light');
      updateSystemTheme();
      mq.addEventListener('change',updateSystemTheme);
      return()=>mq.removeEventListener('change',updateSystemTheme);
    }else{
      applyTheme(theme);
    }
  },[theme]);

  const descResult=useMemo(()=>descText?extractData(descText,lang,mwo,true,false):null,[descText,lang,mwo]);
  const claimsResult=useMemo(()=>claimsText?extractData(claimsText,lang,mwo,true,true):null,[claimsText,lang,mwo]);
  const _empty={signData:{},termData:{},artErrors:[],bareTerms:[],numErrors:[]};
  const{signData,termData,artErrors,bareTerms,numErrors}=(mode==='description'?descResult:claimsResult)??_empty;

  const orphaned=useMemo(()=>computeCrossRef(descResult,claimsResult),[descResult,claimsResult]);

  const allErrors=useMemo(()=>getAllErrors(signData,termData,artErrors,bareTerms,numErrors,mode,dis),[signData,termData,artErrors,bareTerms,numErrors,mode,dis]);

  useEffect(()=>setNavIdx(0),[allErrors.length]);

  const html=useMemo(()=>buildHtml(text,signData,termData,artErrors,bareTerms,numErrors,mode,dis,focusSign),[text,signData,termData,artErrors,bareTerms,numErrors,mode,dis,focusSign]);

  const syncScroll=useCallback(()=>{if(taRef.current&&bdRef.current)bdRef.current.scrollTop=taRef.current.scrollTop;},[]);

  function handleEditorHover(e){
    const ta=taRef.current;if(!ta)return;
    ta.style.pointerEvents='none';
    const el=document.elementFromPoint(e.clientX,e.clientY);
    ta.style.pointerEvents='';
    const sign=el?.dataset?.sign||el?.closest?.('[data-sign]')?.dataset?.sign||null;
    setHoverSign(prev=>prev===(sign||null)?prev:(sign||null));
  }

  useEffect(()=>{
    const bd=bdRef.current;if(!bd)return;
    bd.querySelectorAll('mark[data-sign]').forEach(m=>{
      m.classList.toggle('h-hover',m.dataset.sign===hoverSign);
    });
  },[hoverSign,html]);

  const{errSigns,okSigns}=useMemo(()=>{
    const q=search.toLowerCase(),err=[],ok=[];
    for(const[sign,sData]of Object.entries(signData)){
      if(q&&!sign.includes(q)){
        const termMatch=Object.keys(sData.terms).some(ts=>
          [...(termData[ts]?.rawTerms||[])].some(r=>r.includes(q)));
        if(!termMatch)continue;
      }
      (classify(sign,sData,termData,mode)==='warn'?err:ok).push([sign,sData]);
    }
    const byN=([a],[b])=>parseInt(a)-parseInt(b);
    return{errSigns:err.sort(byN),okSigns:ok.sort(byN)};
  },[signData,termData,mode,search,dis]);

  const visArt=useMemo(()=>{const q=search.toLowerCase();return artErrors.filter(ae=>!q||ae.termStem.includes(q)||[...(termData[ae.termStem]?.rawTerms||[])].some(r=>r.includes(q)));},[artErrors,termData,search]);
  const visArtActive=visArt.filter(ae=>!dis.has('a:'+ae.termStem));
  const visBare=useMemo(()=>{const q=search.toLowerCase();return bareTerms.filter(bt=>!q||bt.term.includes(q)||bt.termStem.includes(q));},[bareTerms,search]);
  const visBareActive=visBare.filter(bt=>!dis.has('b:'+bt.termStem));
  const visNum=useMemo(()=>{const q=search.toLowerCase();return numErrors.filter(ne=>!q||String(ne.value).includes(q)||String(ne.expected).includes(q));},[numErrors,search]);
  const visNumActive=visNum.filter(ne=>!dis.has('n:'+ne.start));
  const errSignsActive=errSigns.filter(([s])=>!dis.has('s:'+s));
  const totalErrs=errSignsActive.length+visArtActive.length+visBareActive.length+visNumActive.length;
  const disCt=dis.size;
  const totalSigns=Object.keys(signData).length;

  function scrollTo(start,end){
    const ta=taRef.current;if(!ta)return;
    ta.focus();ta.setSelectionRange(start,end);
    const lines=text.slice(0,start).split('\n').length;
    ta.scrollTop=Math.max(0,(lines-5)*13.5*1.75);
    syncScroll();
  }

  function doFocusSign(sign){
    setFocusSign(f=>f===sign?null:sign);setFocusArtKey(null);setFocusBareKey(null);setFocusNumKey(null);
    if(signData[sign]?.positions[0]){const p=signData[sign].positions[0];scrollTo(p.signStart,p.signEnd);}
  }
  function doFocusArt(key,pos){setFocusArtKey(f=>f===key?null:key);setFocusSign(null);setFocusBareKey(null);setFocusNumKey(null);scrollTo(pos,pos+2);}
  function doFocusBare(key,start,end){setFocusBareKey(f=>f===key?null:key);setFocusSign(null);setFocusArtKey(null);setFocusNumKey(null);scrollTo(start,end);}
  function doFocusNum(key,start,end){setFocusNumKey(f=>f===key?null:key);setFocusSign(null);setFocusArtKey(null);setFocusBareKey(null);scrollTo(start,end);}

  function navigate(dir){
    if(!allErrors.length)return;
    const next=(navIdx+dir+allErrors.length)%allErrors.length;
    setNavIdx(next);
    const e=allErrors[next];scrollTo(e.start,e.end);
    if(e.type==='sign'){setFocusSign(e.sign);setFocusArtKey(null);setFocusBareKey(null);setFocusNumKey(null);}
    else if(e.type==='art'){setFocusArtKey('art:'+e.start);setFocusSign(null);setFocusBareKey(null);setFocusNumKey(null);}
    else if(e.type==='bare'){setFocusBareKey('bare:'+e.start);setFocusSign(null);setFocusArtKey(null);setFocusNumKey(null);}
    else if(e.type==='num'){setFocusNumKey('num:'+e.start);setFocusSign(null);setFocusArtKey(null);setFocusBareKey(null);}
  }

  function toggleDis(key){setDis(d=>{const n=new Set(d);n.has(key)?n.delete(key):n.add(key);return n;});}
  function disAll(){
    const k=new Set();
    Object.keys(signData).forEach(s=>k.add('s:'+s));
    artErrors.forEach(ae=>k.add('a:'+ae.termStem));
    bareTerms.forEach(bt=>k.add('b:'+bt.termStem));
    numErrors.forEach(ne=>k.add('n:'+ne.start));
    setDis(k);
  }
  function restoreAll(){setDis(new Set());}

  function handleCtxMenu(e){
    e.preventDefault();
    const pos=taRef.current?.selectionStart??0;
    const found=findAtPos(pos,signData,artErrors);
    if(!found)return;
    const items=[];
    if(found.type==='sign'){
      const{sign,pos:p}=found;
      const bs=stem(p.term.split(' ').pop(),lang);
      const cur=1+(mwo[bs]||0);
      items.push({label:t.extendTerm(cur),a:'extend',d:{bs}});
      if(cur>1)items.push({label:t.reduceTerm,a:'reduce',d:{bs}});
      items.push({sep:true});
      const isDis=dis.has('s:'+sign);
      items.push({label:isDis?`↩ Restore "${sign}"`:t.disSign(sign),a:isDis?'rdis':'dis-sign',d:{sign}});
    } else {
      const{ae}=found;
      const isDis=dis.has('a:'+ae.termStem);
      items.push({label:isDis?`↩ Restore article`:t.disArt(ae.termStem),a:isDis?'rdis-art':'dis-art',d:{ts:ae.termStem}});
    }
    items.push({sep:true});
    items.push({label:t.disAll,a:'dis-all',v:'warn'});
    if(disCt)items.push({label:`↩ ${t.restoreAll} (${disCt})`,a:'restore-all'});
    setCtx({x:e.clientX,y:e.clientY,items,label:found.type==='sign'?`Sign ${found.sign}`:`Article: ${found.ae?.article}`});
  }

  function handleCtxAction(a,d){
    if(a==='extend')setMwo(m=>({...m,[d.bs]:(m[d.bs]||0)+1}));
    else if(a==='reduce')setMwo(m=>{const n={...m};n[d.bs]>1?n[d.bs]--:delete n[d.bs];return n;});
    else if(a==='dis-sign')toggleDis('s:'+d.sign);
    else if(a==='rdis')toggleDis('s:'+d.sign);
    else if(a==='dis-art')toggleDis('a:'+d.ts);
    else if(a==='rdis-art')toggleDis('a:'+d.ts);
    else if(a==='dis-all')disAll();
    else if(a==='restore-all')restoreAll();
  }

  function doReset(){
    setDis(new Set());
    setMwo({});
    try{localStorage.removeItem('rsc_mwo');}catch{}
  }

  return(<>
    {ctx&&<CtxMenu menu={ctx} onClose={()=>setCtx(null)} onAction={handleCtxAction}/>}

    <div className="topbar">
      <div className="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/>
        </svg>
        <span>RefSign<em> Checker</em></span>
      </div>
      <div className="spacer"/>
      <div className="theme-toggle">
        <button className={theme==='light'?'active':''} onClick={()=>setTheme('light')}>Light</button>
        <button className={theme==='system'?'active':''} onClick={()=>setTheme('system')}>System</button>
        <button className={theme==='dark'?'active':''} onClick={()=>setTheme('dark')}>Dark</button>
      </div>
      <div className="pill-toggle">
        <button className={mode==='description'?'active':''} onClick={()=>{setMode('description');setFocusSign(null);}}>{t.modeDesc}{descText&&<span className="buf-dot"/>}</button>
        <button className={mode==='claims'?'active':''} onClick={()=>{setMode('claims');setFocusSign(null);}}>{t.modeClaims}{claimsText&&<span className="buf-dot"/>}</button>
      </div>
      <div className="lang-toggle">
        <button className={lang==='en'?'active':''} onClick={()=>setLang('en')}>EN</button>
        <button className={lang==='de'?'active':''} onClick={()=>setLang('de')}>DE</button>
      </div>
    </div>

    <div className="main">
      <div className="editor-pane">
        <div className="pane-hdr">
          <span className="pane-title">{t.editorLbl}</span>
          <span style={{fontSize:'11px',color:'var(--text-dim)',fontFamily:'var(--font-mono)'}}>{t.charCount(text.length)}</span>
        </div>
        <div className="editor-wrap" onMouseMove={handleEditorHover} onMouseLeave={()=>setHoverSign(null)}>
          <div className="backdrop" ref={bdRef} aria-hidden="true" dangerouslySetInnerHTML={{__html:html}}/>
          <textarea className="editor-ta" ref={taRef} value={text}
            placeholder={mode==='description'?t.placeholder_desc:t.placeholder_claims}
            onChange={e=>{mode==='description'?setDescText(e.target.value):setClaimsText(e.target.value);setFocusSign(null);}}
            onScroll={syncScroll} onContextMenu={handleCtxMenu}
            spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
        </div>
        <div className="statusbar">
          {errSignsActive.length>0&&<div className="s-chip" style={{color:'var(--warn)'}}>
            <span className="s-dot" style={{background:'var(--warn)'}}/>{errSignsActive.length} {t.errLbl}
          </div>}
          {visArtActive.length>0&&<div className="s-chip" style={{color:'var(--art)'}}>
            <span className="s-dot" style={{background:'var(--art)'}}/>{visArtActive.length} {t.artLbl}
          </div>}
          {visBareActive.length>0&&<div className="s-chip" style={{color:'var(--bare)'}}>
            <span className="s-dot" style={{background:'var(--bare)'}}/>{visBareActive.length} {t.bareLbl}
          </div>}
          {visNumActive.length>0&&<div className="s-chip" style={{color:'var(--num)'}}>
            <span className="s-dot" style={{background:'var(--num)'}}/>{visNumActive.length} {t.numberingLbl}
          </div>}
          {totalSigns>0&&errSignsActive.length===0&&visArtActive.length===0&&visBareActive.length===0&&visNumActive.length===0&&
            <div className="s-chip" style={{color:'var(--ok)'}}><span className="s-dot" style={{background:'var(--ok)'}}/>All consistent</div>}
          {allErrors.length>0&&<div className="err-nav" style={{marginLeft:'auto'}}>
            <button className="nav-btn" onClick={()=>navigate(-1)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="nav-lbl">{t.navLabel(navIdx+1,allErrors.length)}</span>
            <button className="nav-btn" onClick={()=>navigate(1)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>}
          {disCt>0&&<button className="restore-btn" onClick={restoreAll}>↩ {t.restoreAll} ({disCt})</button>}
          {mode==='claims'&&text.length>0&&<div className="s-chip" style={{color:'var(--text-dim)',fontSize:'11px'}}>{t.claimsNote}</div>}
        </div>
      </div>

      <div className="ov-pane">
        <div className="pane-hdr"><span className="pane-title">{t.ovLbl}</span></div>
        {totalSigns>0&&<div className="stats-row">
          <div className="stat-cell"><span className="stat-n" style={{color:'var(--text)'}}>{totalSigns}</span><span className="stat-l">{t.totalLbl}</span></div>
          <div className="stat-cell"><span className="stat-n" style={{color:totalErrs>0?'var(--warn)':'var(--text-dim)'}}>{totalErrs}</span><span className="stat-l">{t.errLbl}</span></div>
          <div className="stat-cell"><span className="stat-n" style={{color:okSigns.length>0?'var(--ok)':'var(--text-dim)'}}>{okSigns.length}</span><span className="stat-l">{t.okLbl}</span></div>
        </div>}
        {totalSigns>0&&<div className="search-row">
          <input className="search-in" placeholder={t.searchPh} value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>}
        <div className="ov-scroll">
          {totalSigns===0?(
            <div className="ov-empty">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/>
              </svg>
              <p><strong style={{color:'var(--text-muted)'}}>{t.emptyTitle}</strong><br/>{t.emptyBody}</p>
            </div>
          ):(
            <>
              {errSignsActive.length>0&&<>
                <div className="sec-lbl" style={{color:'var(--warn)'}}>⚠ {t.gErr}</div>
                {errSignsActive.map(([sign,sData])=>(
                  <SignCard key={sign} sign={sign} sData={sData} termData={termData}
                    mode={mode} focused={focusSign===sign} t={t} lang={lang}
                    dis={dis} mwo={mwo} onFocus={doFocusSign} onDismiss={toggleDis}
                    hoverSign={hoverSign} onHover={setHoverSign}/>
                ))}
              </>}
              {visArtActive.length>0&&<>
                <div className="sec-lbl" style={{color:'var(--art)'}}>◈ {t.gArt}</div>
                {visArtActive.map((ae,i)=>(
                  <ArtCard key={i} ae={ae} focused={focusArtKey==='art:'+ae.artStart}
                    t={t} dis={dis} onFocus={doFocusArt} onDismiss={toggleDis}/>
                ))}
              </>}
              {visBareActive.length>0&&<>
                <div className="sec-lbl" style={{color:'var(--bare)'}}>∅ {t.gBare}</div>
                {visBareActive.map((bt,i)=>(
                  <BareCard key={i} bt={bt} focused={focusBareKey==='bare:'+bt.termStart}
                    t={t} dis={dis} onFocus={doFocusBare} onDismiss={toggleDis}/>
                ))}
              </>}
              {visNumActive.length>0&&<>
                <div className="sec-lbl" style={{color:'var(--num)'}}>⌗ {t.numberingLbl}</div>
                {visNumActive.map((ne,i)=>(
                  <NumCard key={i} ne={ne} focused={focusNumKey==='num:'+ne.start}
                    t={t} dis={dis} onFocus={doFocusNum} onDismiss={toggleDis}/>
                ))}
              </>}
              {okSigns.length>0&&<>
                <div className="sec-lbl" style={{color:'var(--ok)'}}>✓ {t.gOk}</div>
                {okSigns.map(([sign,sData])=>(
                  <SignCard key={sign} sign={sign} sData={sData} termData={termData}
                    mode={mode} focused={focusSign===sign} t={t} lang={lang}
                    dis={dis} mwo={mwo} onFocus={doFocusSign} onDismiss={toggleDis}
                    hoverSign={hoverSign} onHover={setHoverSign}/>
                ))}
              </>}
              {errSigns.filter(([s])=>dis.has('s:'+s)).length>0&&<>
                <div className="sec-lbl" style={{color:'var(--text-dim)'}}>↩ {t.gDis}</div>
                {errSigns.filter(([s])=>dis.has('s:'+s)).map(([sign,sData])=>(
                  <SignCard key={sign} sign={sign} sData={sData} termData={termData}
                    mode={mode} focused={false} t={t} lang={lang}
                    dis={dis} mwo={mwo} onFocus={doFocusSign} onDismiss={toggleDis}
                    hoverSign={hoverSign} onHover={setHoverSign}/>
                ))}
              </>}
              {disCt>0&&<div className="dis-section">
                <div className="dis-hdr">
                  <span>↩ {t.disCt(disCt)}</span>
                  <button className="ra-btn" onClick={restoreAll}>{t.restoreAll}</button>
                </div>
              </div>}
              {orphaned&&<>
                <div className="sec-lbl" style={{color:'var(--text-muted)'}}>⇄ {t.crossRefLbl}</div>
                {orphaned.signConflicts.map(({sign,descTerms,claimsTerms})=>(
                  <div className="orphan-card" key={'sc'+sign}>
                    <span className="orphan-sign">{sign}</span>
                    <span className="orphan-msg">{t.crossSignConflict(descTerms[0]||'?',claimsTerms[0]||'?')}</span>
                  </div>
                ))}
                {orphaned.termConflicts.map(({ts,rawTerm,descSigns,claimsSigns})=>(
                  <div className="orphan-card" key={'tc'+ts}>
                    <span className="orphan-sign">"{rawTerm}"</span>
                    <span className="orphan-msg">{t.crossTermConflict(descSigns.join('/'),claimsSigns.join('/'))}</span>
                  </div>
                ))}
                {orphaned.missingInDesc.map(s=>(
                  <div className="orphan-card" key={'od'+s}>
                    <span className="orphan-sign">{s}</span>
                    <span className="orphan-msg">{t.missingInDesc}</span>
                  </div>
                ))}
                {orphaned.missingInClaims.map(s=>(
                  <div className="orphan-card" key={'oc'+s}>
                    <span className="orphan-sign">{s}</span>
                    <span className="orphan-msg">{t.missingInClaims}</span>
                  </div>
                ))}
              </>}
            </>
          )}
        </div>
      </div>
    </div>
    <button className="reset-btn" onClick={doReset} title={t.resetAll}>{t.resetAll}</button>
  </>);
}
