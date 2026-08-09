import { useState } from 'react';

// A collapsible card-list section, styled like RefList's own header. Hides
// itself when count is 0 rather than being conditionally mounted by the
// caller, so its open/closed state survives the count dropping to 0 and
// back up (e.g. while the user is mid-edit).
//
// Shared by both side panes: the reference pane needs the same header the
// sidebar sections have, and RefListCheck renders none of its own.
export function Section({
  icon,
  label,
  color,
  count,
  children,
  alwaysShow = false,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Most sections hide themselves at zero; the two that host an input the user
  // types into (the reference-list check, the claim-set panel) must stay
  // reachable even with nothing to report.
  if (!count && !alwaysShow) return null;
  return (
    <div className="sidebar-section">
      <button
        type="button"
        className="sec-lbl sec-lbl-toggle"
        style={{ color }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {icon} {label} ({count})
      </button>
      {open && children}
    </div>
  );
}
