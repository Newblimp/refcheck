import { memo } from 'react';
import { classify } from '../logic/extract.ts';
import { disKey } from '../logic/constants.ts';
import { activatable } from './cardProps.ts';
import type { Mode } from '../logic/constants.ts';
import type { SignEntry, TermEntry } from '../logic/extract.ts';
import type { Strings } from '../i18n.ts';

export interface SignCardProps {
  sign: string;
  sData: SignEntry;
  termData: Record<string, TermEntry>;
  mode: Mode;
  focused: boolean;
  t: Strings;
  dis: Set<string>;
  onFocus: (sign: string) => void;
  onDismiss: (key: string) => void;
  hoverSign: string | null;
  onHover?: (sign: string | null) => void;
}

// ── SIGN CARD ───────────────────────────────────────────────────────────────
function SignCardImpl({
  sign,
  sData,
  termData,
  mode,
  focused,
  t,
  dis,
  onFocus,
  onDismiss,
  hoverSign,
  onHover,
}: SignCardProps) {
  const isDis = dis.has(disKey.sign(sign));
  const sev = isDis ? 'dim' : classify(sData, termData, mode);
  const terms = Object.keys(sData.terms);

  const notes: string[] = [];
  if (!isDis) {
    if (mode === 'claims') {
      const bad = sData.count - sData.inPC;
      if (bad > 0) notes.push(t.claimsBad(bad));
    } else {
      if (terms.length > 1) {
        const raws = terms
          .flatMap((ts) => [...(termData[ts]?.rawTerms || new Set())])
          .filter((v, i, a) => a.indexOf(v) === i);
        notes.push(t.conflictST(raws.slice(0, 3)));
      }
      terms.forEach((ts) => {
        const td = termData[ts];
        if (!td) return;
        const others = Object.keys(td.signs).filter((s2) => s2 !== sign);
        if (others.length > 0) {
          const raw = [...(td.rawTerms || new Set())][0] || ts;
          notes.push(t.conflictTS(raw, others));
        }
      });
    }
  }
  return (
    <div
      className={`sign-card${focused ? ' focused' : ''}${hoverSign === sign ? ' hovered' : ''}`}
      {...activatable(() => onFocus(sign))}
      onMouseEnter={() => onHover && onHover(sign)}
      onMouseLeave={() => onHover && onHover(null)}
    >
      <div className="sc-row">
        <span className={`badge ${sev}`}>{sign}</span>
        <span className="sc-main">
          <div className="term-chips">
            {terms.map((ts) => {
              const isConf =
                sev === 'warn' &&
                (terms.length > 1 || (termData[ts] && Object.keys(termData[ts].signs).length > 1));
              const raw = [...(termData[ts]?.rawTerms || new Set())][0] || ts;
              // Width comes from the term as recorded, per chip. Reading it back
              // out of `mwo` only knew about manual overrides, so a term widened
              // by the ordinal detector or by the reference list showed no badge
              // — and a sign carrying both a one- and a two-word term badged both.
              const wc = ts.split(' ').length;
              return (
                <span key={ts} className={`tc ${isConf ? 'err' : sev === 'ok' ? 'ok' : ''}`}>
                  {raw}
                  {wc > 1 && <span className="mw-badge">{t.wdCt(wc)}</span>}
                </span>
              );
            })}
          </div>
        </span>
        <span className="sc-cnt">{t.occ(sData.count)}</span>
        <button
          className="dis-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(disKey.sign(sign));
          }}
          aria-label={isDis ? t.restoreOne : t.dismissOne}
          title={isDis ? t.restoreOne : t.dismissOne}
        >
          {isDis ? '↩' : '×'}
        </button>
      </div>
      {notes.map((n, i) => (
        <div key={i} className="sc-note">
          ↳ <strong>{n}</strong>
        </div>
      ))}
    </div>
  );
}

// memo: see the card components — identical reasoning, and a document can hold
// hundreds of sign cards.
export const SignCard = memo(SignCardImpl);
