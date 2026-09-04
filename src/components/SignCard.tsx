import { memo } from 'react';
import { classify } from '../logic/extract.ts';
import { disKey } from '../logic/constants.ts';
import { activatable } from './cardProps.ts';
import { DismissButton } from './DismissButton.tsx';
import type { Mode } from '../logic/constants.ts';
import type { SignEntry, TermEntry } from '../logic/extract.ts';
import type { Strings } from '../i18n.ts';

export interface SignCardProps {
  sign: string;
  sData: SignEntry;
  termData: Record<string, TermEntry>;
  mode: Mode;
  focused: boolean;
  /** The term chip the focus currently sits on, if any. */
  focusedTerm: string | null;
  t: Strings;
  dis: Set<string>;
  /** Jump to the sign's occurrences — or, with a term, only those written with it. */
  onFocus: (sign: string, termStem?: string) => void;
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
  focusedTerm,
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
  const rawsOf = (ts: string) => [...(termData[ts]?.rawTerms ?? [])];
  const rawOf = (ts: string) => rawsOf(ts)[0] ?? ts;
  const otherSigns = (ts: string) =>
    Object.keys(termData[ts]?.signs ?? {}).filter((s2) => s2 !== sign);

  const notes: string[] = [];
  if (!isDis) {
    if (mode === 'claims') {
      const bad = sData.count - sData.inPC;
      if (bad > 0) notes.push(t.claimsBad(bad));
    } else {
      if (terms.length > 1)
        notes.push(t.conflictST([...new Set(terms.flatMap(rawsOf))].slice(0, 3)));
      for (const ts of terms) {
        const others = otherSigns(ts);
        if (others.length > 0) notes.push(t.conflictTS(rawOf(ts), others));
      }
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
              const isConf = sev === 'warn' && (terms.length > 1 || otherSigns(ts).length > 0);
              const raw = rawOf(ts);
              // Width comes from the term as recorded, per chip. Reading it back
              // out of `mwo` only knew about manual overrides, so a term widened
              // by the ordinal detector or by the reference list showed no badge
              // — and a sign carrying both a one- and a two-word term badged both.
              const wc = ts.split(' ').length;
              // A real <button>, not another role="button" div: the card is
              // already activatable and nesting the role would be a lie to a
              // screen reader, while a button inside it is the same shape the
              // dismiss control already has. stopPropagation is load-bearing
              // for the same reason it is there — without it the click also
              // cycles the card, which is the thing the chip exists to avoid.
              return (
                <button
                  key={ts}
                  type="button"
                  className={`tc ${isConf ? 'err' : sev === 'ok' ? 'ok' : ''}${
                    focusedTerm === ts ? ' focused' : ''
                  }`}
                  title={t.jumpTerm(raw)}
                  aria-label={t.jumpTerm(raw)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocus(sign, ts);
                  }}
                >
                  {raw}
                  {wc > 1 && <span className="mw-badge">{t.wdCt(wc)}</span>}
                </button>
              );
            })}
          </div>
        </span>
        <span className="sc-cnt">{t.occ(sData.count)}</span>
        <DismissButton dismissed={isDis} disKey={disKey.sign(sign)} onDismiss={onDismiss} t={t} />
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
