import { compareSigns } from './constants.js';

// ── REFERENCE NUMERAL LIST ───────────────────────────────────────────────────
// Turns the extraction result into a sorted sign → term table suitable for a
// patent "List of Reference Signs". Pure (no DOM) so it can be unit-tested and
// reused by the RefList component for copy-to-clipboard.

// Pick the dominant term for a sign: the term stem with the highest occurrence
// count, tie-broken by earliest appearance, resolved to a human-readable raw
// term (matching how SignCard displays the first raw term).
function dominantTerm(sData, termData){
  const stems=Object.keys(sData.terms);
  if(stems.length===0)return '';
  const firstPos={};
  for(const p of sData.positions)
    if(firstPos[p.termStem]===undefined||p.termStart<firstPos[p.termStem])
      firstPos[p.termStem]=p.termStart;
  const best=stems.sort((a,b)=>
    (sData.terms[b]-sData.terms[a]) || ((firstPos[a]??Infinity)-(firstPos[b]??Infinity)))[0];
  return [...(termData[best]?.rawTerms||[])][0]||best;
}

// rows: [{ sign, term, count }] sorted numerically by sign.
export function buildRefList(signData, termData){
  return Object.entries(signData)
    .map(([sign,sData])=>({sign,term:dominantTerm(sData,termData),count:sData.count}))
    .sort((a,b)=>compareSigns(a.sign,b.sign));
}

// Tab-separated "sign<TAB>term" lines for clipboard / pasting into a draft.
export function toPlainText(rows){
  return rows.map(r=>`${r.sign}\t${r.term}`).join('\n');
}
