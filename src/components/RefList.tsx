import { useState, useMemo } from 'react';
import { buildRefList, toPlainText } from '../logic/reflist.ts';
import { Section } from './Section.tsx';
import type { SignEntry, TermEntry } from '../logic/extract.ts';
import type { Strings } from '../i18n.ts';

// ── REFERENCE NUMERAL LIST ───────────────────────────────────────────────────
// The sign → term table derived from the active buffer, collapsed by default,
// with copy-to-clipboard (plain text) for pasting into a draft.
export interface RefListProps {
  signData: Record<string, SignEntry>;
  termData: Record<string, TermEntry>;
  t: Strings;
}

export function RefList({ signData, termData, t }: RefListProps) {
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => buildRefList(signData, termData), [signData, termData]);
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
  const copy = () =>
    navigator.clipboard
      .writeText(toPlainText(rows))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});

  return (
    <Section
      icon="⌗"
      label={t.refListLbl}
      color="var(--text-muted)"
      count={rows.length}
      defaultOpen={false}
      action={
        canCopy &&
        rows.length > 0 && (
          <button className="restore-btn" onClick={copy}>
            {copied ? t.refListCopied : t.refListCopy}
          </button>
        )
      }
    >
      <table className="reflist-table">
        <thead>
          <tr>
            <th>{t.refListColSign}</th>
            <th>{t.refListColTerm}</th>
            <th>{t.refListColCount}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sign}>
              <td className="rl-sign">{r.sign}</td>
              <td className="rl-term">{r.term}</td>
              <td className="rl-count">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
