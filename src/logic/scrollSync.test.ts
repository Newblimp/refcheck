import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { backdropScroll, centerOffset } from './scrollSync.ts';

// A 1000px-tall document in a 400px-tall box: scrollable range is 0…600.
const doc = (scrollTop: number) => backdropScroll(scrollTop, 1000, 400);

describe('backdropScroll', () => {
  it('passes an in-range position straight through with no shift', () => {
    expect(doc(0)).toEqual({ top: 0, shift: 0 });
    expect(doc(250)).toEqual({ top: 250, shift: 0 });
    expect(doc(600)).toEqual({ top: 600, shift: 0 });
  });

  it('splits an overscroll past the bottom into the clamped part and the overshoot', () => {
    // The backdrop can only reach 600; the remaining 40px of rubber-band has
    // to be translated or the highlights lag behind the bouncing text.
    expect(doc(640)).toEqual({ top: 600, shift: 40 });
  });

  it('splits an overscroll past the top the same way, with a negative shift', () => {
    expect(doc(-30)).toEqual({ top: 0, shift: -30 });
  });

  it('handles content shorter than the box — every position is an overshoot', () => {
    expect(backdropScroll(0, 120, 400)).toEqual({ top: 0, shift: 0 });
    expect(backdropScroll(25, 120, 400)).toEqual({ top: 0, shift: 25 });
  });

  it('survives missing geometry rather than emitting NaN into a transform', () => {
    expect(backdropScroll(undefined, undefined, undefined)).toEqual({ top: 0, shift: 0 });
    expect(backdropScroll(NaN, 1000, 400)).toEqual({ top: 0, shift: 0 });
  });

  it('keeps sub-pixel positions exact, so the layers cannot drift by a fraction', () => {
    expect(doc(123.5)).toEqual({ top: 123.5, shift: 0 });
  });
});

// A 1000px-tall document in a 400px-tall box again: scrollable range 0…600, and
// a one-line span 20px tall.
const jump = (top: number, height = 20) => centerOffset(top, height, 400, 1000);

describe('centerOffset', () => {
  it('puts the span in the middle of the box', () => {
    // 500 - (400 - 20)/2 = 310, which leaves the span's own middle (510) at the
    // box's middle (310 + 200).
    expect(jump(500)).toBe(310);
  });

  it('centres the span itself, not its top edge', () => {
    // A term wrapped over three lines is 60px tall; its middle is still what
    // lands in the middle of the box.
    expect(jump(500, 60)).toBe(330);
    expect(500 + 60 / 2 - jump(500, 60)).toBe(400 / 2);
  });

  it('stops at the top rather than scrolling above the document', () => {
    // The first line cannot be centred — there is nothing above it to show.
    expect(jump(0)).toBe(0);
    expect(jump(150)).toBe(0);
  });

  it('stops at the bottom rather than scrolling past the end', () => {
    expect(jump(980)).toBe(600);
  });

  it('returns 0 for content that does not fill the box', () => {
    expect(centerOffset(40, 20, 400, 300)).toBe(0);
  });

  it('survives missing geometry rather than assigning NaN to scrollTop', () => {
    expect(centerOffset(NaN, 20, 400, 1000)).toBe(0);
    expect(centerOffset(500, NaN, NaN, NaN)).toBe(0);
  });
});

describe('editor layer styles', () => {
  it('suppresses elastic overscroll on the editor layers', () => {
    // The rubber-band is a compositor effect that never reaches scrollTop in
    // most engines, so JS alone cannot mirror it — the CSS is load-bearing,
    // not decoration. Losing this line brings the desync straight back.
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const block = css.match(/\.backdrop,\s*\.editor-ta\s*\{([^}]*)\}/);
    expect(block, 'no shared .backdrop/.editor-ta rule in styles.css').toBeTruthy();
    expect(block?.[1]).toMatch(/overscroll-behavior:\s*none/);
  });
});
