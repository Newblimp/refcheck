import { stem } from '../logic/stem.js';
import { classify } from '../logic/extract.js';

// ── SIGN CARD ───────────────────────────────────────────────────────────────
export function SignCard({ sign, sData, termData, mode, focused, t, lang, dis, mwo, onFocus, onDismiss, hoverSign, onHover }) {
  const isDis = dis.has('s:' + sign);
  const sev = isDis ? 'dim' : classify(sign, sData, termData, mode);
  const terms = Object.keys(sData.terms);
  const bs = stem(sData.positions[0]?.term.split(' ').pop() || '', lang);
  const wc = 1 + (mwo[bs] || 0);

  const notes = [];
  if (!isDis) {
    if (mode === 'claims') { const bad = sData.count - sData.inPC; if (bad > 0) notes.push(t.claimsBad(bad)); }
    else {
      if (terms.length > 1) {
        const raws = terms.flatMap(ts => [...(termData[ts]?.rawTerms || new Set())]).filter((v, i, a) => a.indexOf(v) === i);
        notes.push(t.conflictST(raws.slice(0, 3)));
      }
      terms.forEach(ts => {
        const td = termData[ts]; if (!td) return;
        const others = Object.keys(td.signs).filter(s2 => s2 !== sign);
        if (others.length > 0) {
          const raw = [...(td.rawTerms || new Set())][0] || ts;
          notes.push(t.conflictTS(raw, others));
        }
      });
    }
  }
  return (
    <div className={`sign-card${focused ? ' focused' : ''}${hoverSign === sign ? ' hovered' : ''}`}
      onClick={() => onFocus(sign)}
      onMouseEnter={() => onHover && onHover(sign)}
      onMouseLeave={() => onHover && onHover(null)}>
      <div className="sc-row">
        <span className={`badge ${sev}`}>{sign}</span>
        <span className="sc-main">
          <div className="term-chips">
            {terms.map(ts => {
              const isConf = sev === 'warn' && (terms.length > 1 || (termData[ts] && Object.keys(termData[ts].signs).length > 1));
              const raw = [...(termData[ts]?.rawTerms || new Set())][0] || ts;
              return <span key={ts} className={`tc ${isConf ? 'err' : sev === 'ok' ? 'ok' : ''}`}>
                {raw}{wc > 1 && <span className="mw-badge">{t.wdCt(wc)}</span>}
              </span>;
            })}
          </div>
        </span>
        <span className="sc-cnt">{t.occ(sData.count)}</span>
        <button className="dis-btn" onClick={e => { e.stopPropagation(); onDismiss('s:' + sign); }}
          title={isDis ? 'Restore' : 'Dismiss'}>
          {isDis ? '↩' : '×'}
        </button>
      </div>
      {notes.map((n, i) => <div key={i} className="sc-note">↳ <strong>{n}</strong></div>)}
    </div>
  );
}
