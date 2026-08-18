import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contrast, must } from '../test/helpers.ts';

// The CRT screen filter, checked the only way a stylesheet can be: by reading
// it. Four things here are not cosmetic, and each is invisible to every other
// kind of test in this suite.
//
//   · THAT THE PALETTE SHOWS THROUGH. The filter is optics, not a theme — the
//     day/night setting and Gruvbox have to survive it. This file used to
//     replace all thirty-odd palette tokens with a green phosphor set, so the
//     failure mode to guard is one of them creeping back and quietly overruling
//     the theme underneath.
//   · WHAT IT COSTS TO READ. The scanlines are a dark veil over everything,
//     which no token-vs-token check can see, so the shipped themes are re-run
//     through it here with the veil composited in.
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
const themes = {
  dark: block(appCss, ":root[data-theme='dark']"),
  light: block(appCss, ":root[data-theme='light']"),
};

/** Hex-valued tokens only — the rest are rgba fills and underlines. */
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

// How much light the scan layer takes out of the picture, READ OUT OF THE
// STYLESHEET rather than written down here: alpha × duty cycle, so tuning the
// pattern re-tunes the model with it. Averaging a stripe into a uniform veil is
// a simplification of a spatial pattern, but it is the right direction and the
// right order of magnitude, which is what a guard needs.
const scan = must(
  /rgba\(0, 0, 0, ([\d.]+)\) 0 (\d+)px,\s*rgba\(0, 0, 0, 0\) \d+px (\d+)px/.exec(css),
  'scanline pattern'
);
const VEIL = Number(scan[1]) * (Number(scan[2]) / Number(scan[3]));

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

// Not 4.5. The tightest pair in the shipped dark theme is --text-dim on
// --surface2 at 4.59:1, so ANY veil at all leaves AA — that is a fact about how
// close the theme runs to the line, not about this filter, and the filter is
// opt-in besides. What is worth guarding is that it stays CLOSE: 4.0 is where
// the current pattern (0.28 over a third of the screen) sits with a little room,
// and a heavier scanline fails it.
const FLOOR = 4;

describe('CRT palette', () => {
  it('redefines nothing the themes define', () => {
    // The whole point of the current design: Gruvbox dark and the light theme
    // show through the filter unchanged, and the day/night toggle keeps
    // working underneath it. One token redefined here silently overrules the
    // theme — and it would be a plausible-looking line, since this file used to
    // be nothing but thirty of them.
    const theirs = new Set([...Object.keys(themes.dark), ...Object.keys(themes.light)]);
    const taken = Object.keys(crt).filter((name) => theirs.has(name));
    expect(taken, `the filter must not repaint the theme: ${taken.join(', ')}`).toEqual([]);
  });

  it('leaves the editor alignment invariant alone', () => {
    // Making the chrome monospace is the point of a terminal look, but the
    // editor's two layers must keep naming the SAME family or the highlights
    // slide off the text under them. Overriding --font-ui does that by
    // construction; overriding --font-mono would not.
    expect(crt['--font-ui']).toBe('var(--font-mono)');
    expect(crt['--font-mono']).toBeUndefined();
  });

  it('blooms only on a dark theme', () => {
    // The glow is `currentColor`, so on a light theme it is a dark halo around
    // dark text — dirty glass rather than a lit screen. Every rule that sets a
    // glow is therefore scoped to the dark theme; the only unscoped one may be
    // the reset that takes it OFF the backdrop.
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const shadow = /(?:^|[;\s])text-shadow:\s*([^;]+)/.exec(body);
      if (!shadow || shadow[1]?.trim() === 'none') continue;
      expect(selector, `${selector.trim()} glows on every theme`).toContain("[data-theme='dark']");
    }
  });
});

describe.each(['dark', 'light'] as const)('%s theme seen through the filter', (name) => {
  const p = hex(themes[name]);

  it.each(FOREGROUNDS)('%s stays legible under the scanlines', (fg) => {
    for (const bg of SURFACES) {
      const r = contrast(veiled(must(p[fg], fg)), veiled(must(p[bg], bg)));
      expect(
        r,
        `${name} ${fg} on ${bg} is ${r.toFixed(2)}:1 through a ${(VEIL * 100).toFixed(1)}% veil`
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe('CRT stylesheet discipline', () => {
  // The same two scans palette.test.ts runs over styles.css. They are rules
  // about CSS rather than about one file, and this file is a second place
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
    // the look depending on load order. html + :root + [attr] beats
    // :root + [attr].
    expect(css).toContain("html:root[data-crt='on']");
    expect(css).not.toMatch(/(?<!html):root\[data-crt/);
  });
});

describe('CRT tube geometry', () => {
  it('draws the curvature instead of applying it', () => {
    // The bulge is a bezel whose opening bows, not `filter: url(#barrel)` on a
    // wrapper. A real displacement would re-run over the whole layer on every
    // repaint, make the element the containing block for every fixed
    // descendant, and — the part that decides it — leave hit testing behind
    // with the undistorted geometry, so the caret would land somewhere other
    // than where the character appears.
    expect(css).not.toMatch(/(?:^|[;\s])filter:/);
    const outside = css.replace(/@keyframes[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/(?:^|[;\s])transform:/);
  });

  it('stretches the bezel to any window', () => {
    // preserveAspectRatio='none' over a 0-100 viewBox is what makes one path
    // responsive; clip-path's path() takes absolute units only and would be
    // pinned to whatever window it was drawn for.
    expect(css).toContain("viewBox='0 0 100 100'");
    expect(css).toContain("preserveAspectRatio='none'");
  });

  it('cuts the opening as a hole rather than painting a shape', () => {
    // The bezel is the OUTSIDE of the barrel: a full-box rectangle with the
    // face subtracted from it by the even-odd rule. Without the rectangle the
    // path fills the screen instead of framing it.
    expect(css).toContain("fill-rule='evenodd'");
    expect(css).toContain('M0 0h100v100H0z');
  });

  it('bows the raster by the same fraction of the width at every size', () => {
    // The scan arcs come from a circle whose radius is in vw, so the sag scales
    // with the window: a radius in px would read as a fisheye on a phone and
    // flatten out to straight lines on a wide monitor.
    expect(css).toMatch(/repeating-radial-gradient\(\s*circle \d+vw at 50% \d+vw/);
  });

  it('draws the edge of the glass rather than sampling it', () => {
    // The four strokes on the opening, in paint order: the blurred bevel (the
    // lit thickness), a warm stroke a hair outside and a cool one a hair inside
    // (dispersion — thick glass splits what it bends), and the specular rim.
    // Together they are what makes the border read as glass rather than as a
    // rounded frame, and they cost nothing: it is all one static layer.
    expect(css, 'no blurred bevel').toContain('feGaussianBlur');
    expect(css, 'no outer (warm) fringe').toMatch(/stroke='%23ffb27a'[^/]*scale\(1\.008\)/);
    expect(css, 'no inner (cool) fringe').toMatch(/stroke='%237fd4ff'[^/]*scale\(\.992\)/);
  });

  it('never reads the backdrop', () => {
    // `backdrop-filter: blur()` on a rim-shaped layer is the honest way to smear
    // what you see through thick glass, and it was built and then removed on the
    // measurements: on a 100 KB description it took the editor's scroll from a
    // 16.7 ms median frame to 65 ms and keystroke-to-paint from 67 ms to 136 ms.
    // Four thin strips instead of one layer only recovered 24 ms / 97 ms, and
    // four small corner squares measured the same as the strips — so there is no
    // cheap placement of it. Every other part of this filter measures free.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/backdrop-filter:/);
  });

  it('drifts the scanlines by exactly one period', () => {
    // The scan loop is seamless only if the travel equals the pattern's period:
    // the end state has to be pixel-identical to the start, or every cycle ends
    // in a visible jump. (On arcs it is exact on the vertical axis and off by
    // x²p/2R² elsewhere — a fiftieth of a pixel at the corners.) Both numbers
    // are read back rather than trusted, since they live 100 lines apart and
    // either one can be tuned alone.
    const travel = must(
      /@keyframes crt-scan[\s\S]*?to\s*\{[^}]*translateY\((\d+)px\)/.exec(css)?.[1],
      'scan travel'
    );
    expect(travel).toBe(scan[3]);
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
    // the tube face is not motion at all. Hiding either would leave a button
    // that reads as doing nothing.
    expect(rest).not.toMatch(/#root::before[^{]*\{[^}]*display:\s*none/);
    expect(rest).not.toMatch(/body::after[^{]*\{[^}]*display:\s*none/);
  });
});

describe('CRT overlay layers', () => {
  const layers = ['#root::before', 'body::after', 'body::before', '#root::after'];

  it.each(layers)('%s never swallows a pointer event', (layer) => {
    const m = new RegExp(`${layer}\\s*\\{([^}]*)\\}`).exec(css);
    expect(m, `no rule for ${layer}`).not.toBeNull();
    expect(must(m?.[1], layer)).toMatch(/pointer-events:\s*none/);
  });

  it('keeps the corners of the app clear of the bezel', () => {
    // The opening closes in at the corners, and the app puts something in every
    // one of them: the logo, the help button, the pane chevrons and the fixed
    // reset button. The picture is inset to match, and the reset button — being
    // fixed, so the inset does not reach it — is moved by hand.
    expect(css).toMatch(/#root\s*\{[^}]*padding:/);
    expect(css).toMatch(/\.reset-btn\s*\{[^}]*(right|bottom):/);
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
