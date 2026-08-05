// ── BEE FLIGHT ───────────────────────────────────────────────────────────────
// Pure motion model for the easter-egg bee, kept out of the component so it can
// be unit-tested in the node environment like the rest of logic/.
//
// Bees do not glide — they dart. The model is therefore steer-toward-a-waypoint
// with a SHORT waypoint lifetime (a quarter-second or so) plus per-frame jitter
// and heavy damping, which produces the characteristic stop-start zig-zag
// instead of a smooth curve. After LIFESPAN seconds the bee picks an exit
// waypoint outside a random edge and leaves.
//
// Every function takes an `rnd` so tests can drive it deterministically.

export const LIFESPAN = 14; // seconds of wandering before heading for an exit
export const MAX_AGE = 45; // hard stop, so a bee can never get stuck on screen
const SPAWN_MARGIN = 40; // how far outside the edge it starts
const EXIT_MARGIN = 200; // how far outside the edge it aims when leaving
const GONE_MARGIN = 120; // past this, it has left the screen
const EDGE_PAD = 48; // wander waypoints stay this far inside the viewport

/** Pick a point just outside one of the four edges. side: 0=top 1=right 2=bottom 3=left */
function edgePoint(side, w, h, margin, rnd) {
  switch (side & 3) {
    case 0:
      return { x: rnd() * w, y: -margin };
    case 1:
      return { x: w + margin, y: rnd() * h };
    case 2:
      return { x: rnd() * w, y: h + margin };
    default:
      return { x: -margin, y: rnd() * h };
  }
}

/** Choose the next waypoint: a nearby point while wandering, an off-screen point
 *  once the bee has decided to leave. */
export function pickTarget(b, w, h, rnd = Math.random) {
  if (b.leaving) {
    const p = edgePoint(Math.floor(rnd() * 4), w, h, EXIT_MARGIN, rnd);
    b.tx = p.x;
    b.ty = p.y;
    b.retargetIn = 3;
    return b;
  }
  // Roughly one waypoint in four is a hover: the bee stays put and buzzes on the
  // spot before darting off again, which is most of what reads as "bee".
  const hovering = rnd() < 0.26;
  const reach = hovering ? 16 : 280;
  b.tx = Math.min(w - EDGE_PAD, Math.max(EDGE_PAD, b.x + (rnd() * 2 - 1) * reach));
  b.ty = Math.min(h - EDGE_PAD, Math.max(EDGE_PAD, b.y + (rnd() * 2 - 1) * reach));
  b.retargetIn = hovering ? 0.3 + rnd() * 0.45 : 0.2 + rnd() * 0.5;
  return b;
}

/** A bee entering from a random side, aimed inward. */
export function spawnBee(w, h, rnd = Math.random) {
  const entrySide = Math.floor(rnd() * 4) & 3;
  const { x, y } = edgePoint(entrySide, w, h, SPAWN_MARGIN, rnd);
  const b = {
    x,
    y,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
    age: 0,
    retargetIn: 0,
    leaving: false,
    entered: false,
    dir: 1,
    entrySide,
  };
  // First waypoint is inside the viewport, so it always flies in rather than
  // hovering at the edge it spawned on.
  b.tx = EDGE_PAD + rnd() * Math.max(1, w - EDGE_PAD * 2);
  b.ty = EDGE_PAD + rnd() * Math.max(1, h - EDGE_PAD * 2);
  b.retargetIn = 0.5 + rnd() * 0.5;
  return b;
}

/** Advance the simulation by `dt` seconds (mutates and returns `b`). */
export function stepBee(b, dt, w, h, rnd = Math.random) {
  b.age += dt;
  b.retargetIn -= dt;
  if (!b.leaving && b.age >= LIFESPAN) {
    b.leaving = true;
    pickTarget(b, w, h, rnd);
  } else if (b.retargetIn <= 0) {
    pickTarget(b, w, h, rnd);
  }

  const dx = b.tx - b.x,
    dy = b.ty - b.y;
  const d = Math.hypot(dx, dy) || 1;
  const accel = b.leaving ? 1000 : 760;
  // Jitter is a real acceleration, comparable to the steering term: that balance
  // is what makes the track twitch and overshoot instead of curving smoothly.
  // Once the bee is leaving it calms down and flies out purposefully.
  const jitter = b.leaving ? 220 : 1150;
  b.vx += ((dx / d) * accel + (rnd() * 2 - 1) * jitter) * dt;
  b.vy += ((dy / d) * accel + (rnd() * 2 - 1) * jitter) * dt;

  // Damping is what makes it dart-and-settle rather than orbit the waypoint.
  const damp = Math.pow(0.88, dt * 60);
  b.vx *= damp;
  b.vy *= damp;

  const sp = Math.hypot(b.vx, b.vy);
  const max = b.leaving ? 520 : 340;
  if (sp > max) {
    b.vx = (b.vx / sp) * max;
    b.vy = (b.vy / sp) * max;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Face the direction of travel, but only on a decisive horizontal move, or the
  // sprite flickers during the jitter.
  if (Math.abs(b.vx) > 14) b.dir = b.vx < 0 ? -1 : 1;
  if (!b.entered && b.x > 0 && b.x < w && b.y > 0 && b.y < h) b.entered = true;
  return b;
}

/** True once the bee has been on screen and then left it (or overstayed). */
export function beeGone(b, w, h) {
  if (b.age > MAX_AGE) return true;
  if (!b.entered) return false;
  return b.x < -GONE_MARGIN || b.x > w + GONE_MARGIN || b.y < -GONE_MARGIN || b.y > h + GONE_MARGIN;
}

/**
 * How many times the trigger word appears (the typed trigger).
 *
 * "bee" always counts; "Biene"/"Bienen" counts as well when German is the
 * active language. Word boundaries keep compounds out — "beetle" and
 * "Bienenstock" are not the user asking for a bee.
 *
 * @param {string} text
 * @param {'en'|'de'} [lang]
 */
export function countBees(text, lang) {
  if (!text) return 0;
  const s = String(text);
  let n = (s.match(/\bbees?\b/gi) || []).length;
  if (lang === 'de') n += (s.match(/\bbienen?\b/gi) || []).length;
  return n;
}
