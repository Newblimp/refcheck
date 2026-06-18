import { EXCL, isArt, isOrd, artType, isSignToken, isClaimNumber, SIGN_RE } from './constants.js';
import { stem } from './stem.js';
import { tokenize } from './tokenize.js';

// ── EXTRACTION ─────────────────────────────────────────────────────────────
export function detectOrdStems(tokens,lang,text,isClaims){
  const s=new Set();
  for(let i=2;i<tokens.length;i++){
    const t=tokens[i];
    if(!isSignToken(t.word))continue;
    if(isClaims&&isClaimNumber(text,t))continue;
    const p1=tokens[i-1],p2=tokens[i-2];
    if(!p1||!p2)continue;
    const l1=p1.word.toLowerCase();
    if(EXCL.has(l1)||isArt(l1,lang)||p1.word.length<2)continue;
    if(isOrd(p2.word,lang))s.add(stem(p1.word,lang));
  }
  return s;
}

// Walk backwards from token index `i` collecting the term tokens (and a leading
// article) that belong to the sign at `i`. Returns {allTT, artTok}.
function collectTermToks(toks,i,lang){
  let j=i-1,artTok=null;
  const allTT=[];
  while(j>=0&&allTT.length<5){
    const t=toks[j];
    const lo=t.word.toLowerCase();
    if(/^\d/.test(t.word))break;
    if(isArt(lo,lang)){artTok=t;break;}
    if(t.word.length<2){j--;continue;}
    if(EXCL.has(lo))break;
    allTT.unshift(t);
    j--;
  }
  return {allTT,artTok};
}

export function extractData(text,lang,mwo={},autoMW=true,isClaims=false){
  const toks=tokenize(text);
  const ordStems=autoMW?detectOrdStems(toks,lang,text,isClaims):new Set();
  const signData={},termData={},artByTerm={},termFirstPos={};
  const claimNums=[];
  const noTermSigns=new Set();

  // Record one occurrence of `sign` against the term described by `allTT`.
  // Shared by the main scan and range detection. Pass artTok=null to skip
  // article bookkeeping (range endpoints reuse the term's already-seen article).
  function recordOccurrence(sign,signStart,signEnd,allTT,artTok,inParens){
    const baseW=allTT[allTT.length-1].word;
    const bs=stem(baseW,lang);
    const manExtra=mwo[bs]||0;
    let autoExtra=0;
    if(ordStems.has(bs)&&allTT.length>=2&&isOrd(allTT[allTT.length-2].word,lang))autoExtra=1;
    const wc=1+Math.max(manExtra,autoExtra);
    const termToks=allTT.slice(Math.max(0,allTT.length-wc));

    const termStr=termToks.map(t=>t.word.toLowerCase()).join(' ');
    const termStem=termToks.map(t=>stem(t.word,lang)).join(' ');
    const termStart=termToks[0].start,termEnd=termToks[termToks.length-1].end;

    if(!signData[sign])signData[sign]={terms:{},positions:[],count:0,inPC:0};
    signData[sign].terms[termStem]=(signData[sign].terms[termStem]||0)+1;
    signData[sign].count++;
    if(inParens)signData[sign].inPC++;
    signData[sign].positions.push({termStart,termEnd,signStart,signEnd,term:termStr,termStem,inParens});

    if(!termData[termStem])termData[termStem]={signs:{},rawTerms:new Set()};
    termData[termStem].signs[sign]=(termData[termStem].signs[sign]||0)+1;
    termData[termStem].rawTerms.add(termStr);

    if(termFirstPos[termStem]===undefined||termStart<termFirstPos[termStem])
      termFirstPos[termStem]=termStart;

    if(artTok&&termToks.length===allTT.length){
      const al=artTok.word.toLowerCase();
      if(!artByTerm[termStem])artByTerm[termStem]=[];
      artByTerm[termStem].push({article:al,type:artType(al),artStart:artTok.start,artEnd:artTok.end,termStart,signStart,sign,termStem});
    }
  }

  for(let i=0;i<toks.length;i++){
    const tok=toks[i];
    if(!isSignToken(tok.word))continue;
    if(isClaims&&isClaimNumber(text,tok)){claimNums.push({value:parseInt(tok.word,10),start:tok.start,end:tok.end});continue;}
    const sign=tok.word;
    const signStart=tok.start,signEnd=tok.end;
    const inParens=signStart>0&&text[signStart-1]==='('&&text[signEnd]===')';

    const {allTT,artTok}=collectTermToks(toks,i,lang);
    if(allTT.length===0){noTermSigns.add(sign);continue;}
    recordOccurrence(sign,signStart,signEnd,allTT,artTok,inParens);
  }

  // ── Sign ranges / lists (endpoints only) ──
  // "screws 18 to 22", "18 bis 22", "18 and 22", "18 und 22", "18–22", "18-22".
  // The digit-connector-digit adjacency keeps "a housing 12 and a cover 14"
  // (distinct terms, with words between the connector and the second number)
  // from being misread as a range. Only the two endpoints are registered.
  const RANGE_RE=new RegExp(`(${SIGN_RE})\\s*(?:to|bis|and|und|[-–—])\\s*(${SIGN_RE})`,'gi');
  let rm;
  while((rm=RANGE_RE.exec(text))!==null){
    const a=rm[1],b=rm[2];
    if(!isSignToken(a)||!isSignToken(b))continue;
    const aStart=rm.index;
    const bStart=rm.index+rm[0].length-b.length;
    // Index of the first token at/after the first endpoint; the shared term is
    // whatever precedes it (works whether or not the endpoints tokenized).
    let baseIdx=toks.findIndex(t=>t.start>=aStart);
    if(baseIdx<0)baseIdx=toks.length;
    const {allTT}=collectTermToks(toks,baseIdx,lang);
    if(allTT.length===0)continue; // no shared term (e.g. "claims 1 to 5") → skip
    if(!signData[a])recordOccurrence(a,aStart,aStart+a.length,allTT,null,false);
    if(!signData[b])recordOccurrence(b,bStart,bStart+b.length,allTT,null,false);
  }

  // Generate article errors
  const artErrors=[];
  for(const[ts,occs]of Object.entries(artByTerm)){
    occs.sort((a,b)=>a.artStart-b.artStart);
    const firstTermPos=termFirstPos[ts]??Infinity;
    occs.forEach((occ)=>{
      const isFirst=occ.termStart===firstTermPos;
      if(isFirst&&occ.type==='def')artErrors.push({...occ,errType:'first-def'});
      else if(!isFirst&&occ.type==='indef')artErrors.push({...occ,errType:'repeat-indef'});
    });
    // German gender consistency: flag if nominative def articles conflict
    if(lang==='de'){
      const nomDef=occs.filter(o=>['der','die','das'].includes(o.article));
      if(new Set(nomDef.map(o=>o.article)).size>1){
        const seen=new Set();
        for(const occ of nomDef){
          if(!seen.size){seen.add(occ.article);continue;}
          if(!seen.has(occ.article)){
            artErrors.push({...occ,errType:'de-gender',prevArt:[...seen][0]});
            seen.add(occ.article);
          }
        }
      }
    }
  }
  // ── Bare-term detection (second pass) ──
  // Build index: stem of last word → [termStem, …] sorted longest-first
  const baseToTerms={};
  for(const ts of Object.keys(termData)){
    const parts=ts.split(' ');
    const base=parts[parts.length-1];
    if(!baseToTerms[base])baseToTerms[base]=[];
    baseToTerms[base].push(ts);
  }
  for(const k of Object.keys(baseToTerms))
    baseToTerms[k].sort((a,b)=>b.split(' ').length-a.split(' ').length);

  // Collect all term ranges already associated with a sign
  const knownRanges=[];
  for(const sData of Object.values(signData))
    for(const p of sData.positions)knownRanges.push([p.termStart,p.termEnd]);

  const bareTerms=[];
  const bareSpans=new Set();
  for(let i=0;i<toks.length;i++){
    const s=stem(toks[i].word,lang);
    if(!baseToTerms[s])continue;
    for(const ts of baseToTerms[s]){
      const parts=ts.split(' ');
      const wc=parts.length;
      if(i<wc-1)continue;
      let match=true;
      for(let k=0;k<wc;k++){
        if(stem(toks[i-(wc-1)+k].word,lang)!==parts[k]){match=false;break;}
      }
      if(!match)continue;
      const tStart=toks[i-(wc-1)].start,tEnd=toks[i].end;
      let coveredByKnown=false;
      for(const[ks,ke]of knownRanges){if(tStart>=ks&&tEnd<=ke){coveredByKnown=true;break;}}
      if(coveredByKnown)break;
      if(bareSpans.has(`${tStart}-${tEnd}`))break;
      // Skip if immediately followed by a sign token
      const nxt=toks[i+1];
      if(nxt&&isSignToken(nxt.word)&&!(isClaims&&isClaimNumber(text,nxt)))break;
      const signs=Object.keys(termData[ts]?.signs||{});
      bareSpans.add(`${tStart}-${tEnd}`);
      bareTerms.push({termStart:tStart,termEnd:tEnd,termStem:ts,
        term:toks.slice(i-(wc-1),i+1).map(t=>t.word.toLowerCase()).join(' '),signs});
      break;
    }
  }

  // ── Claim-numbering consistency (claims mode) ──
  const numErrors=[];
  let expected=1;
  for(const cn of claimNums){
    if(cn.value!==expected)numErrors.push({value:cn.value,expected,start:cn.start,end:cn.end});
    expected=cn.value+1;
  }

  return{signData,termData,artErrors,bareTerms,numErrors,noTermSigns};
}

// ── CLASSIFICATION ─────────────────────────────────────────────────────────
export function classify(sign,sData,termData,mode){
  if(mode==='claims'&&sData.count>sData.inPC)return 'warn';
  if(Object.keys(sData.terms).length>1)return 'warn';
  for(const t of Object.keys(sData.terms)){
    if(termData[t]&&Object.keys(termData[t].signs).length>1)return 'warn';
  }
  return 'ok';
}

export function getAllErrors(signData,termData,artErrors,bareTerms,numErrors,mode,dis){
  const out=[];
  for(const[sign,sData]of Object.entries(signData)){
    if(dis.has('s:'+sign))continue;
    if(classify(sign,sData,termData,mode)==='warn')
      for(const p of sData.positions)out.push({type:'sign',start:p.signStart,end:p.signEnd,sign});
  }
  for(const ae of artErrors){
    if(dis.has('a:'+ae.termStem))continue;
    out.push({type:'art',start:ae.artStart,end:ae.artEnd,ae});
  }
  for(const bt of bareTerms){
    if(dis.has('b:'+bt.termStem))continue;
    out.push({type:'bare',start:bt.termStart,end:bt.termEnd,bt});
  }
  for(const ne of numErrors){
    if(dis.has('n:'+ne.start))continue;
    out.push({type:'num',start:ne.start,end:ne.end,ne});
  }
  out.sort((a,b)=>a.start-b.start);
  return out;
}
