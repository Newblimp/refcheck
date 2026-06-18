import { classify } from './extract.js';

// ── HTML BUILDER ────────────────────────────────────────────────────────────
export const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function buildHtml(text,signData,termData,artErrors,bareTerms,numErrors,mode,dis,focusSign){
  if(!text)return '';
  const spans=[];
  for(const[sign,sData]of Object.entries(signData)){
    const isDis=dis.has('s:'+sign);
    const sev=isDis?'dis':classify(sign,sData,termData,mode);
    const focused=focusSign===sign;
    for(const p of sData.positions){
      const cls=sev==='warn'?'h-warn':sev==='dis'?'h-dis':'h-ok';
      spans.push({start:p.signStart,end:p.signEnd,cls:focused?cls+' h-focus':cls,sign});
      if(sev==='warn')spans.push({start:p.termStart,end:p.termEnd,cls:'h-wt'});
    }
  }
  for(const ae of artErrors){
    if(dis.has('a:'+ae.termStem))continue;
    spans.push({start:ae.artStart,end:ae.artEnd,cls:'h-art'});
  }
  for(const bt of bareTerms){
    if(dis.has('b:'+bt.termStem))continue;
    spans.push({start:bt.termStart,end:bt.termEnd,cls:'h-bare'});
  }
  for(const ne of numErrors){
    if(dis.has('n:'+ne.start))continue;
    spans.push({start:ne.start,end:ne.end,cls:'h-num'});
  }
  spans.sort((a,b)=>a.start-b.start||a.end-b.end);
  const clean=[];let cur=0;
  for(const sp of spans){if(sp.start>=cur){clean.push(sp);cur=sp.end;}}
  let html='',pos=0;
  for(const sp of clean){
    if(sp.start>pos)html+=esc(text.slice(pos,sp.start));
    const ds=sp.sign?` data-sign="${sp.sign}"`:'';
    html+=`<mark class="${sp.cls}"${ds}>${esc(text.slice(sp.start,sp.end))}</mark>`;
    pos=sp.end;
  }
  if(pos<text.length)html+=esc(text.slice(pos));
  return html;
}

export function findAtPos(charPos,signData,artErrors){
  for(const ae of artErrors)
    if(charPos>=ae.artStart&&charPos<=ae.artEnd)return{type:'art',ae};
  for(const[sign,sData]of Object.entries(signData))
    for(const p of sData.positions)
      if(charPos>=p.termStart&&charPos<=p.signEnd)return{type:'sign',sign,pos:p};
  return null;
}
