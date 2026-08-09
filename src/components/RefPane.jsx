import { memo } from 'react';
import { RefList } from './RefList.jsx';
import { RefListCheck } from './RefListCheck.jsx';
import { Section } from './Section.jsx';

// ── REFERENCE PANE (left column) ────────────────────────────────────────────
// Everything about the reference-sign list, kept together and away from the
// error cards: the numeral list the tool derives from the text on top, the
// drafter's own list — which they can edit, and which export writes back — at
// the bottom.
//
// Unlike the sidebar's sections this renders even with an empty document. A
// drafter working from an existing list wants to paste it in before typing a
// word, and while it lived in the sidebar's `totalSigns > 0` branch there was
// nowhere to put it.
function RefPaneImpl({ t, signData, termData, refListText, onRefListChange, reconciled }) {
  const findings = reconciled
    ? reconciled.termMismatch.length +
      reconciled.duplicates.length +
      reconciled.listedNotUsed.length +
      reconciled.usedNotListed.length
    : 0;

  return (
    <div className="ref-scroll">
      <RefList signData={signData} termData={termData} t={t} />
      <Section
        icon="☰"
        label={t.reconcileLbl}
        color="var(--text-muted)"
        count={findings}
        alwaysShow
      >
        <RefListCheck value={refListText} onChange={onRefListChange} result={reconciled} t={t} />
      </Section>
    </div>
  );
}

// memo for the same reason as Sidebar: this re-renders on every keystroke
// otherwise, and App keeps its props stable.
export const RefPane = memo(RefPaneImpl);
