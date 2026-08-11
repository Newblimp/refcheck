// ── ICONS ───────────────────────────────────────────────────────────────────
// The inline SVGs, kept together and out of the components that use them.
// They were ~150 lines of path data sitting in the middle of App.jsx's JSX,
// which made the actual layout hard to read.
//
// All of them are stroke icons on a 24×24 grid inheriting `currentColor`, so a
// caller sets the colour with CSS and nothing here hardcodes a theme. The one
// exception is the logo, which is deliberately drawn in the accent colour.
//
// They are plain functions rather than memo'd components: an SVG element tree
// with no props is as cheap as the memo bookkeeping would be.

// `as const` so strokeLinecap/strokeLinejoin keep their literal types — the SVG
// attribute types are unions of literals, not plain strings.
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** The document mark in the top-left, drawn in the accent colour. */
export const LogoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} stroke="var(--accent)">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="12" y2="17" />
  </svg>
);

export const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MonitorIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
    <rect x="2" y="4" width="20" height="13" rx="1.5" />
    <path d="M8 20h8M12 17v3" />
  </svg>
);

export const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
    <path d="M20 12.5A8 8 0 1 1 11.5 4a6.5 6.5 0 0 0 8.5 8.5z" />
  </svg>
);

/** Error-nav chevrons. Heavier stroke, and no caps — they are 10px wide. */
export const ChevronLeftIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

/** The sidebar's empty state. Lighter stroke — it is a 44px illustration. */
export const EmptyDocIcon = () => (
  <svg width="44" height="44" viewBox="0 0 24 24" {...stroke} strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 9h6M9 12h6M9 15h4" />
  </svg>
);
