import type { ComponentChildren } from 'preact';

export interface OrphanCardProps {
  /** The mono label on the left — a reference sign, or a quoted term. */
  label: ComponentChildren;
  /** The finding itself. */
  children: ComponentChildren;
}

// ── ORPHAN CARD ──────────────────────────────────────────────────────────────
// The label/message row shared by the two panes that report a finding about one
// sign: the sidebar's cross-reference section and the reference-list check.
//
// It was written out nine times across those two files — five in Sidebar, four
// in RefListCheck — differing only in the label and the message. That is not a
// payload saving (gzip already collapsed the repetition, measured at ten bytes);
// it is one place to change the markup rather than nine to keep in step.
export const OrphanCard = ({ label, children }: OrphanCardProps) => (
  <div className="orphan-card">
    <span className="orphan-sign">{label}</span>
    <span className="orphan-msg">{children}</span>
  </div>
);
