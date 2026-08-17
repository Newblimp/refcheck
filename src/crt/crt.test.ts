import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, must } from '../test/helpers.ts';

// The CRT screen filter, checked the only way a stylesheet can be: by reading
// it. Three things here are not cosmetic, and each of them is invisible to
// every other kind of test in this suite.
//
//   · CONTRAST. The filter replaces the whole palette, so it leaves the matrix
//     in palette.test.ts behind entirely — a green-on-green token pair would
//     ship unnoticed. It also draws a dark veil over the result, which no
//     token-vs-token check can see, so the bar here is higher than AA and there
//     is a second pass with the veil composited in.
//   · WHAT ANIMATES. transform and opacity are the two properties the
//     compositor can run on its own. The layers below cover the viewport, so
//     animating anything else would repaint the editor's backdrop every frame —
//     on a 100 KB description, the most expensive paint in the app.
//   · WHAT THE LAYERS SWALLOW. The editor hit-tests hover with
//     elementFromPoint. A full-screen overlay that answered would kill sign
//     highlighting outright, exactly as it would for the bee or the drop
//     overlay.

const dir = new URL('.', import.meta.url);
const css = readFileSync(new URL('crt.css', dir), 'utf8');
const appCss = readFileSync(new URL('../styles.css', dir), 'utf8');

/** The `--token: value` declarations of a block, by selector. */
function block(source: string, selector: string): Record<string, string> {
  const i = source.indexOf(selector + ' {');
  if (i < 0) throw new Error(`no "${selector}" block`);
  const body = source.slice(i, source.indexOf('\n}', i));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm))
    out[name] = value.trim();
  return out;
}

const crt = block(css, "html:root[data-crt='on']");
const dark = block(appCss, ":root[data-theme='dark']");

/** Hex-valued tokens only; the rest are derived with color-mix. */
const hex = (p: Record<string, string>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => /^#[0-9a-fA-F]{3,8}$/.test(v)));

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

// The scanline layer is rgba(0,0,0,0.3) over one row in every three, so the
// screen behind it loses about a tenth of its light everywhere — and the
// flicker dips further still. Modelling it as a uniform black veil is a
// simplification of a spatial pattern, but it is the right direction and the
// right order of magnitude, which is what a guard needs.
const VEIL = 0.12;
const veiled = (h: string): string => {
  const s = h.replace('#', '');
  const n =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  const dim = [0, 2, 4].map((i) => Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - VEIL)));
  return '#' + dim.map((c) => c.toString(16).padStart(2, '0')).join('');
};

describe('CRT palette', () => {
  it('redefines every token the themes define', () => {
    // Anything left out falls back to whichever theme is underneath, which is
    // how you get one orange chip on a green screen — or worse, a light-theme
    // surface behind CRT text.
    for (const token of Object.keys(dark))
      expect(crt[token], `CRT mode does not define ${token}`).toBeDefined();
  });

  it.each(FOREGROUNDS)('%s clears 7:1 on every surface', (fg) => {
    const p = hex(crt);
    for (const bg of SURFACES) {
      const r = contrast(must(p[fg], fg), must(p[bg], bg));
      expect(r, `${fg} on ${bg} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(7);
    }
  });

  it.each(FOREGROUNDS)('%s still clears WCAG AA under the scanlines', (fg) => {
    const p = hex(crt);
    for (const bg of SURFACES) {
      const r = contrast(veiled(must(p[fg], fg)), veiled(must(p[bg], bg)));
      expect(r, `${fg} on ${bg} veiled is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the text ramp ordered: text > muted > dim', () => {
    const p = hex(crt);
    const on = (t: string) => contrast(must(p[t], t), must(p['--surface'], '--surface'));
    expect(on('--text')).toBeGreaterThan(on('--text-muted'));
    expect(on('--text-muted')).toBeGreaterThan(on('--text-dim'));
  });

  it('clears AA for text drawn on the accent fill', () => {
    const p = hex(crt);
    expect(
      contrast(must(p['--on-accent'], 'on-accent'), must(p['--accent'], 'accent'))
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves the editor alignment invariant alone', () => {
    // Making the chrome monospace is the point of a terminal look, but the
    // editor's two layers must keep naming the SAME family or the highlights
    // slide off the text under them. Overriding --font-ui does that by
    // construction; overriding --font-mono would not.
    expect(crt['--font-ui']).toBe('var(--font-mono)');
    expect(crt['--font-mono']).toBeUndefined();
  });
});

describe('CRT stylesheet discipline', () => {
  // The same two scans palette.test.ts runs over styles.css. They are rules
  // about CSS rather than about one file, and this file is now a second place
  // colours are written.
  it('paints text with tokens, never with literal colours', () => {
    const literals = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      for (const [, value] of body.matchAll(/(?:^|[;\s])color:\s*([^;]+)/g)) {
        const v = value.trim();
        if (/^var\(--/.test(v) || ['inherit', 'currentColor', 'transparent'].includes(v)) continue;
        literals.push(`${selector.trim()} { color: ${v} }`);
      }
    expect(literals).toEqual([]);
  });

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
    expect(offenders).toEqual([]);
  });

  it('outranks the theme blocks whatever order the browser applies them in', () => {
    // The stylesheet is injected at runtime, so equal specificity would leave
    // the entire palette depending on load order. html + :root + [attr] beats
    // :root + [attr].
    expect(css).toContain("html:root[data-crt='on']");
    expect(css).not.toMatch(/(?<!html):root\[data-crt/);
  });
});

/** Every `@keyframes name { … }` in the file, brace-balanced. */
function keyframes(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    out.push({ name: must(m[1], 'keyframes name'), body: source.slice(re.lastIndex, i - 1) });
  }
  return out;
}

describe('CRT animations', () => {
  const frames = keyframes(css);

  it('has some', () => {
    expect(frames.length).toBeGreaterThan(0);
  });

  it.each(frames)('$name animates only transform and opacity', ({ body }) => {
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(['transform', 'opacity']).toContain(p);
  });

  it('drifts the scanlines by exactly one period', () => {
    // The scan loop is seamless only if the travel equals the pattern's period:
    // the end state has to be pixel-identical to the start, or every cycle ends
    // in a visible jump. Both numbers are read back rather than trusted, since
    // they live 150 lines apart and either one can be tuned alone.
    const period = must(/rgba\(0, 0, 0, 0\)\s+\d+px\s+(\d+)px/.exec(css)?.[1], 'scanline period');
    const travel = must(
      /@keyframes crt-scan[\s\S]*?to\s*\{[^}]*translateY\((\d+)px\)/.exec(css)?.[1],
      'scan travel'
    );
    expect(travel).toBe(period);
  });

  it('runs no animation it does not define', () => {
    const defined = new Set(frames.map((f) => f.name));
    for (const [, value] of css.matchAll(/(?:^|[;\s])animation:\s*([^;]+)/g)) {
      const name = must(value.trim().split(/\s+/)[0], 'animation name');
      if (name === 'none') continue;
      expect(defined, `animation: ${name} has no @keyframes`).toContain(name);
    }
  });

  it('drops the moving parts under prefers-reduced-motion', () => {
    const i = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(i, 'no reduced-motion block').toBeGreaterThan(0);
    const rest = css.slice(i);
    expect(rest).toContain('animation: none');
    // …and keeps the look: standing still, the scan layer IS the scanlines, and
    // the tube is not motion at all. Hiding either would leave a button that
    // reads as doing nothing.
    expect(rest).not.toMatch(/#root::before[^{]*\{[^}]*display:\s*none/);
    expect(rest).not.toMatch(/body::after[^{]*\{[^}]*display:\s*none/);
  });
});

describe('CRT overlay layers', () => {
  // Selector → declarations, for the rules that create the fixed layers.
  const layers = ['#root::before', 'body::after', 'body::before', '#root::after'];

  it.each(layers)('%s never swallows a pointer event', (layer) => {
    const m = new RegExp(`${layer.replace('#', '#')}\\s*\\{([^}]*)\\}`).exec(css);
    expect(m, `no rule for ${layer}`).not.toBeNull();
    expect(must(m?.[1], layer)).toMatch(/pointer-events:\s*none/);
  });

  it('never wraps the app in a filter, and transforms only the layers', () => {
    // A filter or a transform on an element that CONTAINS the app forces the
    // whole thing into one re-rasterized layer, and makes it the containing
    // block for every position:fixed descendant — the context menu, the bee,
    // the drop overlay and the reset button. The look is a palette plus
    // overlays for exactly this reason, so `filter` appears nowhere and
    // `transform` only inside the keyframes that drive the two overlays.
    expect(css).not.toMatch(/(?:^|[;\s])filter:/);
    const outside = css.replace(/@keyframes[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/(?:^|[;\s])transform:/);
  });
});

describe('CRT loading', () => {
  const src = new URL('../', dir).pathname;
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      const full = join(d, e);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  it('is never imported statically', () => {
    // A static import anywhere would fold the stylesheet into the entry chunk,
    // which is inlined into index.html — the whole point of the split is that a
    // first visit does not pay for a filter it never switches on. A dynamic
    // `import('./crt.css')` has a paren where a static one has whitespace,
    // which is the whole difference this looks for.
    const offenders = walk(src)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /import\s+(?:[^;]*from\s+)?'[^']*crt\.css'/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('imports it dynamically', () => {
    expect(readFileSync(new URL('load.ts', dir), 'utf8')).toMatch(/import\('\.\/crt\.css'\)/);
  });
});
