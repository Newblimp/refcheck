import { useEffect, useRef, useState } from 'react';
import { spawnBee, stepBee, beeGone } from '../logic/beeFlight.js';
import beeUrl from '../assets/bee.svg';

// The bee itself. Position is written straight to the DOM node each frame rather
// than held in state — a 60fps setState would re-render the whole app, and the
// app re-renders are the expensive part (extraction, highlight building).
//
// The element is pointer-events:none so it can never swallow a click or disturb
// the editor's elementFromPoint hover hit-testing. Hover is therefore detected
// geometrically: we track the pointer and compare it to the bee's own position.
export function Bee({ t, onDone }) {
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = () => window.innerWidth;
    const h = () => window.innerHeight;

    const bee = spawnBee(w(), h());
    const mouse = { x: -9999, y: -9999 };
    const onMove = e => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener('mousemove', onMove, { passive: true });

    let raf = 0;
    let last = performance.now();
    let stopped = false;

    const frame = now => {
      if (stopped) return;
      // Clamp dt so a backgrounded tab does not teleport the bee on return.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      stepBee(bee, dt, w(), h());

      // A little wing-beat bob, independent of the flight path. The heading flip
      // goes on the sprite alone — on the wrapper it would mirror the bubble.
      const bob = Math.sin(now / 55) * 2.5;
      el.style.transform =
        `translate3d(${bee.x.toFixed(1)}px, ${(bee.y + bob).toFixed(1)}px, 0)`;
      if (imgRef.current) imgRef.current.style.transform = `scaleX(${bee.dir})`;

      const hit = Math.hypot(mouse.x - bee.x, mouse.y - bee.y) < 34;
      if (hit !== nearRef.current) { nearRef.current = hit; setNear(hit); }

      if (beeGone(bee, w(), h())) { onDone?.(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
    };
  }, [onDone]);

  return (
    <div className="bee-wrap" ref={wrapRef} aria-hidden="true">
      <div className={`bee-bubble${near ? ' show' : ''}`}>{t.beeSays}</div>
      <img className="bee-img" ref={imgRef} src={beeUrl} alt="" width="34" height="34" draggable="false" />
    </div>
  );
}
