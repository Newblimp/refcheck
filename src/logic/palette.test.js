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
});
