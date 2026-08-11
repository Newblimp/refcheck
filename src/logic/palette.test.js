import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Contrast regression guard for the two themes.
//
// The palette used to have two outright failures — light `--accent` at 2.66 and
// dark `--text-dim` at 2.70 against the surfaces they actually render on — plus
// several tokens sitting just under the line. Nothing caught it, because
// contrast is invisible to every other kind of test.
//
// WCAG AA for normal-size text is 4.5:1. Every foreground token below is used as
// small text somewhere (the multi-word badge is 10px, the import language tag is
// 11px), so 4.5 is the right bar rather than the 3:1 large-text allowance.

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function palette(theme) {
  const m = new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (!m) throw new Error(`no ${theme} theme block in styles.css`);
  const out = {};
  for (const line of m[1].split('\n')) {
    const d = /^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line);
    if (d) out[d[1]] = d[2];
  }
  return out;
}

const toRgb = (h) => {
  const s = h.replace('#', '');
  const n =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrast(a, b) {
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every surface a foreground token can land on. --surface2 is the card
// hover/focus background, which is why dim text has to clear it too.
const SURFACES = ['--bg', '--surface', '--surface2'];
const FOREGROUNDS = [
  '--text',
  '--text-muted',
  '--text-dim',
  '--accent',
  '--warn',
  '--art',
  '--ok',
  '--bare',
  '--num',
  '--dep',
  '--info',
];
// Pairs where the background is a coloured fill, not a surface. `where` names
// the rule so a failure points at the CSS rather than at a token.
const COLOURED_FILLS = [{ fg: '--on-accent', bg: '--accent', where: '.lang-toggle button.active' }];
const AA = 4.5;

describe.each(['dark', 'light'])('%s theme contrast', (theme) => {
  const p = palette(theme);

  it('defines every token the components reference', () => {
    for (const token of [...FOREGROUNDS, ...SURFACES]) {
      expect(p[token], `${theme} is missing ${token}`).toBeDefined();
    }
  });

  it.each(FOREGROUNDS)('%s clears WCAG AA on every surface', (fg) => {
    for (const bg of SURFACES) {
      const r = contrast(p[fg], p[bg]);
      expect(
        r,
        `${theme} ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${AA}:1`
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps the text ramp ordered: text > muted > dim', () => {
    // A pure contrast fix can invert this by accident — lifting dim text far
    // enough to pass would otherwise make it lighter than the muted tier and
    // destroy the visual hierarchy.
    const on = (t) => contrast(p[t], p['--surface']);
    expect(on('--text')).toBeGreaterThan(on('--text-muted'));
    expect(on('--text-muted')).toBeGreaterThan(on('--text-dim'));
  });

  // Text drawn on a coloured FILL rather than on one of the three surfaces. The
  // matrix above cannot reach these by construction — it pairs foreground
  // tokens with background tokens — and the gap was not hypothetical: the active
  // language pill was white on --accent at 2.17:1, which a Lighthouse run
  // caught and this file did not. Add a row whenever a rule paints text on
  // anything that is not --bg/--surface/--surface2.
  it.each(COLOURED_FILLS)('$fg on $bg clears WCAG AA ($where)', ({ fg, bg }) => {
    const r = contrast(p[fg], p[bg]);
    expect(r, `${theme} ${fg} on ${bg} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
  });
});

// Text colour and opacity in one rule — the other thing the matrix cannot see.
//
// `opacity` composites the element AND its background against whatever is
// behind it, so a token pair that clears AA on its own can render below it:
// --text-dim on --surface2 is 4.59:1, and the reset button's `opacity: 0.7`
// rendered it at 3.05:1. Nothing in a token-vs-token check can catch that,
// because both tokens are innocent.
//
// This is the general form of that bug rather than the instance: any rule that
// dims text with opacity has left the palette's guarantees, so the rule itself
// is what fails. Two things are out of scope, and both fall out of the rule
// rather than needing an allowlist: decorative opacity sets no `color` at all
// (.buf-dot, .ov-empty svg), and a fully transparent element is not dimmed text
// but hidden text (.bee-bubble, which fades in to opacity 1) — there is no
// contrast question about something nobody can see.
describe('stylesheet colour discipline', () => {
  it('never combines a text colour with a partial opacity', () => {
    const offenders = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const opacity = /(?:^|[;\s])opacity:\s*([\d.]+)/.exec(body);
      if (!opacity) continue;
      const value = Number(opacity[1]);
      if (value <= 0 || value >= 1) continue;
      if (!/(?:^|[;\s])color:/.test(body)) continue;
      offenders.push(`${selector.trim()} (opacity: ${value})`);
    }
    expect(
      offenders,
      `these rules dim text with opacity, which composites it against whatever ` +
        `is behind and voids the contrast guarantees above:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  // Everything above checks TOKENS. A literal colour in a rule is therefore
  // outside the guard entirely, which is how both Lighthouse failures got in:
  // `color: #fff` on the active language pill (2.17:1) and `color: #e05252` on
  // the reset button's hover state (3.04 dark / 2.82 light). Requiring a token
  // is what puts a new colour under the matrix instead of beside it.
  //
  // `transparent` (the textarea, whose text is drawn by the backdrop under it)
  // and `inherit` are not colours in this sense and are allowed by name.
  it('paints text with tokens, never with literal colours', () => {
    const literals = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const [, value] of body.matchAll(/(?:^|[;\s])color:\s*([^;]+)/g)) {
        const v = value.trim();
        if (/^var\(--/.test(v) || ['inherit', 'currentColor', 'transparent'].includes(v)) continue;
        literals.push(`${selector.trim()} { color: ${v} }`);
      }
    }
    expect(
      literals,
      `define a token in both themes and use var(--token) instead, so the ` +
        `contrast matrix above covers it:\n  ${literals.join('\n  ')}`
    ).toEqual([]);
  });
});
