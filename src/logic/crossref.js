// ── CROSS-REFERENCE ─────────────────────────────────────────────────────────
// Compares the extraction results of the Description and Claims buffers and
// reports signs/terms that are present in one but missing or conflicting in the
// other. Returns null when there is nothing to report.
export function computeCrossRef(descResult, claimsResult){
  if(!descResult||!claimsResult)return null;
  const dS=new Set(Object.keys(descResult.signData));
  const cS=new Set(Object.keys(claimsResult.signData));
  const missingInDesc=[...cS].filter(s=>!dS.has(s)).sort((a,b)=>+a-+b);
  const missingInClaims=[...dS].filter(s=>!cS.has(s)).sort((a,b)=>+a-+b);

  // Same sign, different term across buffers
  const signConflicts=[];
  for(const sign of [...dS].filter(s=>cS.has(s))){
    const dT=Object.keys(descResult.signData[sign].terms);
    const cT=Object.keys(claimsResult.signData[sign].terms);
    if(!dT.some(t=>cT.includes(t))){
      const dRaw=[...new Set(dT.flatMap(ts=>[...(descResult.termData[ts]?.rawTerms||[])]))];
      const cRaw=[...new Set(cT.flatMap(ts=>[...(claimsResult.termData[ts]?.rawTerms||[])]))];
      signConflicts.push({sign,descTerms:dRaw,claimsTerms:cRaw});
    }
  }
  signConflicts.sort((a,b)=>+a.sign-+b.sign);

  // Same term, different sign across buffers
  const termConflicts=[];
  const dTD=new Set(Object.keys(descResult.termData));
  const cTD=new Set(Object.keys(claimsResult.termData));
  for(const ts of [...dTD].filter(t=>cTD.has(t))){
    const dSigns=Object.keys(descResult.termData[ts].signs);
    const cSigns=Object.keys(claimsResult.termData[ts].signs);
    if(!dSigns.some(s=>cSigns.includes(s))){
      const rawTerm=[...(descResult.termData[ts].rawTerms||[])][0]||ts;
      termConflicts.push({ts,rawTerm,descSigns:dSigns.sort((a,b)=>+a-+b),claimsSigns:cSigns.sort((a,b)=>+a-+b)});
    }
  }

  const hasAny=missingInDesc.length||missingInClaims.length||signConflicts.length||termConflicts.length;
  return hasAny?{missingInDesc,missingInClaims,signConflicts,termConflicts}:null;
}
