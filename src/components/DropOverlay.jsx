// Full-window drop affordance, shown only while a file is being dragged over
// the page. It sits above the editor's textarea + backdrop layers, but is
// pointer-events:none so it never interferes with the editor's hover
// hit-testing (App.jsx toggles pointerEvents on the textarea to find marks).
export function DropOverlay({ visible, t }) {
  if (!visible) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-card">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M12 18v-6M9 15l3-3 3 3" />
        </svg>
        <strong>{t.impDropTitle}</strong>
        <span>{t.impDropHint}</span>
      </div>
    </div>
  );
}
