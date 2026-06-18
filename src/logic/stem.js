// ── STEMMING ── Porter (EN) + Snowball (DE) ────────────────────────────────
export function stemEn(w){
  w=w.toLowerCase();
  if(w.length<=2)return w;
  const isv=(s,i)=>s[i]==='y'?(i>0&&!isv(s,i-1)):/[aeiou]/.test(s[i]);
  const mg=s=>{let n=0,v=false;for(let i=0;i<s.length;i++){if(isv(s,i)){if(!v)v=true;}else if(v){n++;v=false;}}return n;};
  const hv=s=>{for(let i=0;i<s.length;i++)if(isv(s,i))return true;return false;};
  const dbl=s=>{const n=s.length;return n>=2&&s[n-1]===s[n-2]&&!isv(s,n-1);};
  const cvc=s=>{const n=s.length;return n>=3&&!isv(s,n-1)&&!'wxy'.includes(s[n-1])&&isv(s,n-2)&&!isv(s,n-3);};
  // 1a
  if(w.endsWith('sses'))w=w.slice(0,-2);
  else if(w.endsWith('ies'))w=w.slice(0,-2);
  else if(!w.endsWith('ss')&&w.endsWith('s'))w=w.slice(0,-1);
  // 1b
  let b=false;
  if(w.endsWith('eed')){if(mg(w.slice(0,-3))>0)w=w.slice(0,-1);}
  else if(w.endsWith('ed')&&hv(w.slice(0,-2))){w=w.slice(0,-2);b=true;}
  else if(w.endsWith('ing')&&hv(w.slice(0,-3))){w=w.slice(0,-3);b=true;}
  if(b){
    if(w.endsWith('at'))w+='e';
    else if(w.endsWith('bl'))w+='e';
    else if(w.endsWith('iz'))w+='e';
    else if(dbl(w)&&!'lsz'.includes(w[w.length-1]))w=w.slice(0,-1);
    else if(mg(w)===1&&cvc(w))w+='e';
  }
  // 1c
  if(w.length>2&&w.endsWith('y')&&hv(w.slice(0,-1)))w=w.slice(0,-1)+'i';
  // 2
  for(const[s,r]of[['ational','ate'],['tional','tion'],['enci','ence'],['anci','ance'],
    ['izer','ize'],['abli','able'],['alli','al'],['entli','ent'],['eli','e'],
    ['ousli','ous'],['ization','ize'],['ation','ate'],['ator','ate'],['alism','al'],
    ['iveness','ive'],['fulness','ful'],['ousness','ous'],['aliti','al'],
    ['iviti','ive'],['biliti','ble']]){
    if(w.endsWith(s)){const t=w.slice(0,-s.length);if(mg(t)>0){w=t+r;break;}}
  }
  // 3
  for(const[s,r]of[['icate','ic'],['ative',''],['alize','al'],['iciti','ic'],
    ['ical','ic'],['ful',''],['ness','']]){
    if(w.endsWith(s)){const t=w.slice(0,-s.length);if(mg(t)>0){w=t+r;break;}}
  }
  // 4
  let m4=false;
  for(const s of['ement','ment','ance','ence','able','ible','ant','ent','ism',
    'ate','iti','ous','ive','ize','al','er','ic','ou']){
    if(w.endsWith(s)){const t=w.slice(0,-s.length);if(mg(t)>1){w=t;m4=true;break;}}
  }
  if(!m4&&w.endsWith('ion')){const t=w.slice(0,-3);if(mg(t)>1&&/[st]$/.test(t))w=t;}
  // 5a
  if(w.endsWith('e')){const t=w.slice(0,-1);if(mg(t)>1||(mg(t)===1&&!cvc(t)))w=t;}
  // 5b
  if(mg(w)>1&&dbl(w)&&w.endsWith('l'))w=w.slice(0,-1);
  return w;
}

export function stemDe(w){
  w=w.toLowerCase().replace(/ß/g,'ss');
  if(w.length<=2)return w;
  const isv=c=>/[aeiouyäöü]/.test(c);
  function r1p(s){for(let i=1;i<s.length;i++)if(isv(s[i-1])&&!isv(s[i]))return Math.max(3,i+1);return s.length;}
  const p1=r1p(w),p2=p1+r1p(w.slice(p1));
  const ir1=n=>n>=p1,ir2=n=>n>=p2;
  const VS=new Set([...'bdfghklmnrt']),VST=new Set([...'bdfghklmnt']);
  // Step 1 – noun inflections
  let found=false;
  for(const s of['ern','em','er','en','es','e']){
    const p=w.length-s.length;
    if(w.endsWith(s)&&ir1(p)){w=w.slice(0,p);found=true;break;}
  }
  if(!found){const p=w.length-1;if(w.endsWith('s')&&ir1(p)&&p>0&&VS.has(w[p-1]))w=w.slice(0,p);}
  // Step 2 – verb inflections
  found=false;
  for(const s of['est','en','er']){
    const p=w.length-s.length;
    if(w.endsWith(s)&&ir1(p)){w=w.slice(0,p);found=true;break;}
  }
  if(!found){const p=w.length-2;if(w.endsWith('st')&&ir1(p)&&p>0&&VST.has(w[p-1]))w=w.slice(0,p);}
  // Step 3 – derivational suffixes in R2
  const wl=w.length;
  if(w.endsWith('keit')&&ir2(wl-4)){
    w=w.slice(0,-4);
    if(w.endsWith('lich')&&ir2(w.length-4))w=w.slice(0,-4);
    else if(w.endsWith('ig')&&ir2(w.length-2))w=w.slice(0,-2);
  }else if(w.endsWith('heit')&&ir2(wl-4)){
    w=w.slice(0,-4);
    if((w.endsWith('er')||w.endsWith('en'))&&ir1(w.length-2))w=w.slice(0,-2);
  }else if(w.endsWith('lich')&&ir2(wl-4)){
    w=w.slice(0,-4);
    if((w.endsWith('er')||w.endsWith('en'))&&ir1(w.length-2))w=w.slice(0,-2);
  }else if(w.endsWith('isch')&&ir2(wl-4)&&w[wl-5]!=='e'){
    w=w.slice(0,-4);
  }else if(w.endsWith('ung')&&ir2(wl-3)){
    w=w.slice(0,-3);
    if(w.endsWith('ig')&&ir2(w.length-2)&&w[w.length-3]!=='e')w=w.slice(0,-2);
  }else if(w.endsWith('end')&&ir2(wl-3)){
    w=w.slice(0,-3);
    if(w.endsWith('ig')&&ir2(w.length-2)&&w[w.length-3]!=='e')w=w.slice(0,-2);
  }else if(w.endsWith('ik')&&ir2(wl-2)&&w[wl-3]!=='e'){
    w=w.slice(0,-2);
  }else if(w.endsWith('ig')&&ir2(wl-2)&&w[wl-3]!=='e'){
    w=w.slice(0,-2);
  }
  return w.replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u');
}

export const stem = (w, l) => l === 'de' ? stemDe(w) : stemEn(w);
