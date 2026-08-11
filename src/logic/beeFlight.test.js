import { describe, it, expect } from 'vitest';
import { spawnBee, stepBee, beeGone, pickTarget, LIFESPAN, MAX_AGE } from './beeFlight.js';
import { countBees } from './beeCount.ts';

const W = 1200,
  H = 800;
// Deterministic "random" so flights are reproducible.
const seq = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const mid = () => 0.5;

/** Fly until the bee leaves, returning the path. */
function flyOut(rnd = Math.random, maxSteps = 20000) {
  const b = spawnBee(W, H, rnd);
  const path = [{ x: b.x, y: b.y }];
  for (let i = 0; i < maxSteps; i++) {
    stepBee(b, 1 / 60, W, H, rnd);
    path.push({ x: b.x, y: b.y });
    if (beeGone(b, W, H)) break;
  }
  return { b, path };
}

describe('spawnBee', () => {
  it('starts just outside one of the four edges', () => {
    for (const r of [0.0, 0.3, 0.6, 0.9]) {
      const b = spawnBee(W, H, () => r);
      const outside = b.x < 0 || b.x > W || b.y < 0 || b.y > H;
      expect(outside, `side for ${r}`).toBe(true);
    }
  });
  it('uses each of the four sides across the random range', () => {
    const sides = new Set([0.1, 0.35, 0.6, 0.85].map((r) => spawnBee(W, H, () => r).entrySide));
    expect(sides.size).toBe(4);
  });
  it('aims its first waypoint inside the viewport, so it flies in', () => {
    const b = spawnBee(W, H, mid);
    expect(b.tx).toBeGreaterThan(0);
    expect(b.tx).toBeLessThan(W);
    expect(b.ty).toBeGreaterThan(0);
    expect(b.ty).toBeLessThan(H);
  });
  it('has not entered yet at spawn', () => {
    expect(spawnBee(W, H, mid).entered).toBe(false);
  });
});

describe('stepBee', () => {
  it('flies onto the screen and marks itself entered', () => {
    const b = spawnBee(W, H, mid);
    for (let i = 0; i < 300; i++) stepBee(b, 1 / 60, W, H, mid);
    expect(b.entered).toBe(true);
  });
  it('moves like a bee: the path is jagged, not a straight line', () => {
    const rnd = seq([0.13, 0.87, 0.41, 0.62, 0.08, 0.95, 0.5, 0.27, 0.73, 0.34]);
    const { path } = flyOut(rnd);
    // Count heading reversals — a smooth glide has almost none, a bee has many.
    let flips = 0;
    for (let i = 2; i < path.length; i++) {
      const a = path[i - 1].x - path[i - 2].x;
      const c = path[i].x - path[i - 1].x;
      if (a !== 0 && c !== 0 && Math.sign(a) !== Math.sign(c)) flips++;
    }
    expect(flips).toBeGreaterThan(5);
  });
  it('retargets frequently while wandering', () => {
    const b = spawnBee(W, H, mid);
    b.retargetIn = 0.01;
    stepBee(b, 1 / 60, W, H, mid);
    expect(b.retargetIn).toBeGreaterThan(0);
    expect(b.retargetIn).toBeLessThanOrEqual(1);
  });
  it('keeps its speed bounded', () => {
    const rnd = seq([0.2, 0.9, 0.05, 0.7, 0.44]);
    const b = spawnBee(W, H, rnd);
    for (let i = 0; i < 2000; i++) {
      stepBee(b, 1 / 60, W, H, rnd);
      expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(521);
    }
  });
  it('decides to leave once it is past its lifespan', () => {
    const b = spawnBee(W, H, mid);
    expect(b.leaving).toBe(false);
    b.age = LIFESPAN;
    stepBee(b, 1 / 60, W, H, mid);
    expect(b.leaving).toBe(true);
  });
  it('faces the direction it is travelling', () => {
    const b = spawnBee(W, H, mid);
    b.vx = 200;
    stepBee(b, 1 / 60, W, H, mid);
    expect(b.dir).toBe(1);
    b.vx = -200;
    b.tx = -500;
    stepBee(b, 1 / 60, W, H, mid);
    expect(b.dir).toBe(-1);
  });
  it("does not teleport on a large frame gap (dt is the caller's to clamp)", () => {
    const b = spawnBee(W, H, mid);
    const x0 = b.x;
    stepBee(b, 0.05, W, H, mid);
    expect(Math.abs(b.x - x0)).toBeLessThan(60);
  });
});

describe('beeGone', () => {
  it('is false while the bee is still on screen', () => {
    const b = spawnBee(W, H, mid);
    b.entered = true;
    b.x = W / 2;
    b.y = H / 2;
    expect(beeGone(b, W, H)).toBe(false);
  });
  it('is false at spawn, before it has ever entered', () => {
    expect(beeGone(spawnBee(W, H, mid), W, H)).toBe(false);
  });
  it('is true once it has entered and then left through any side', () => {
    for (const [x, y] of [
      [-500, 400],
      [W + 500, 400],
      [600, -500],
      [600, H + 500],
    ]) {
      const b = spawnBee(W, H, mid);
      b.entered = true;
      b.x = x;
      b.y = y;
      expect(beeGone(b, W, H)).toBe(true);
    }
  });
  it('is true past the hard age cap even if somehow still on screen', () => {
    const b = spawnBee(W, H, mid);
    b.x = W / 2;
    b.y = H / 2;
    b.age = MAX_AGE + 1;
    expect(beeGone(b, W, H)).toBe(true);
  });
});

describe('a whole flight', () => {
  it('enters, stays a while, and exits through a side', () => {
    const rnd = seq([0.11, 0.83, 0.37, 0.55, 0.92, 0.24, 0.68, 0.49]);
    const { b, path } = flyOut(rnd);
    expect(b.entered).toBe(true);
    expect(beeGone(b, W, H)).toBe(true);
    expect(b.age).toBeGreaterThan(1); // it stuck around
    expect(b.age).toBeLessThanOrEqual(MAX_AGE);
    expect(path.length).toBeGreaterThan(120);
  });
  it('always terminates, from every entry side', () => {
    for (const r of [0.1, 0.35, 0.6, 0.85]) {
      const rnd = seq([r, 0.4, 0.7, 0.2, 0.9, 0.55]);
      const { b } = flyOut(rnd);
      expect(beeGone(b, W, H), `entry side ${r}`).toBe(true);
    }
  });
});

describe('countBees', () => {
  it('counts the word, case-insensitively, singular and plural', () => {
    expect(countBees('a bee')).toBe(1);
    expect(countBees('BEE and Bee and bees')).toBe(3);
  });
  it('does not fire on a word that merely contains "bee"', () => {
    expect(countBees('beetle been beef Aberdeen')).toBe(0);
  });
  it('handles empty input', () => {
    expect(countBees('')).toBe(0);
    expect(countBees(null)).toBe(0);
  });
  it('counts "Biene" only when German is active', () => {
    expect(countBees('eine Biene', 'de')).toBe(1);
    expect(countBees('zwei Bienen und eine Biene', 'de')).toBe(2);
    expect(countBees('BIENE', 'de')).toBe(1);
    expect(countBees('eine Biene', 'en')).toBe(0);
    expect(countBees('eine Biene')).toBe(0);
  });
  it('still counts "bee" in German', () => {
    expect(countBees('a bee and eine Biene', 'de')).toBe(2);
  });
  it('does not fire on a German compound containing "Biene"', () => {
    expect(countBees('Bienenstock Bienenwachs Bienenkorb', 'de')).toBe(0);
  });
});
