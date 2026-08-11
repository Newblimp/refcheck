import type { ReconcileResult } from '../logic/reconcile.ts';
import type { Strings } from '../i18n.ts';

import { memo } from 'react';

// ── REFERENCE-LIST CHECK ────────────────────────────────────────────────────
// Paste the draft's own "List of Reference Signs" / "Bezugszeichenliste" and
// see where it has drifted from the text. A .docx import fills this in
// automatically — splitPatentDoc already locates that section.
//
// The list is not only compared against the text: the multi-word terms it
// spells out ("30 control unit") are matched in the text and applied there
// automatically (see logic/listTerms.js). That is silent work on the drafter's
// text, so the panel says what it did — and the note is information, not a
// finding, so it borrows the claim-set panel's ⓘ rather than a warning.
const MW_SHOWN = 6;

export interface RefListCheckProps {
  value: string;
  onChange: (value: string) => void;
  result: ReconcileResult | null;
  /** Multi-word terms the list contributed to the extraction. */
  multiWord: string[];
  t: Strings;
}

function RefListCheckImpl({ value, onChange, result, multiWord, t }: RefListCheckProps) {
  return (
    <div className="rlc-body">
      <textarea
        className="rlc-in"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={t.reconcilePh}
        aria-label={t.reconcileLbl}
        rows={4}
        spellcheck={false}
      />
      {multiWord.length > 0 && (
        <div className="cs-note" title={t.mwAppliedHint}>
          <span className="cs-note-icon" aria-hidden="true">
            ⓘ
          </span>
          <span>
            {t.mwApplied(multiWord.length)}:{' '}
            {multiWord
              .slice(0, MW_SHOWN)
              .map((term) => `“${term}”`)
              .join(', ')}
            {multiWord.length > MW_SHOWN ? ' …' : ''}
          </span>
        </div>
      )}
      {result && !result.hasAny && <div className="rlc-ok">✓ {t.reconcileOk(result.matched)}</div>}
      {result?.termMismatch.map(({ sign, listTerm, textTerm }) => (
        <div className="orphan-card" key={'tm' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">{t.refTermMismatch(listTerm, textTerm)}</span>
        </div>
      ))}
      {result?.duplicates.map(({ sign, terms }) => (
        <div className="orphan-card" key={'dup' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">{t.refDuplicate(terms)}</span>
        </div>
      ))}
      {result?.listedNotUsed.map(({ sign, term }) => (
        <div className="orphan-card" key={'lnu' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">
            "{term}" — {t.listedNotUsed}
          </span>
        </div>
      ))}
      {result?.usedNotListed.map(({ sign, term }) => (
        <div className="orphan-card" key={'unl' + sign}>
          <span className="orphan-sign">{sign}</span>
          <span className="orphan-msg">
            "{term}" — {t.usedNotListed}
          </span>
        </div>
      ))}
    </div>
  );
}

export const RefListCheck = memo(RefListCheckImpl);
