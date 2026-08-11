import { useEffect, useState } from 'react';
import type { FunctionComponent } from 'preact';
import type { BeeProps } from './Bee.tsx';

type Loaded = FunctionComponent<BeeProps> | null;

// The bee is an easter egg most users never trigger, but Bee.jsx, the flight
// model and the sprite URL all shipped on the critical path regardless. This
// defers them to the moment a bee is actually summoned — the same treatment the
// .docx pipeline gets, and for the same reason.
//
// A plain dynamic import rather than React.lazy/Suspense: there is no Suspense
// boundary anywhere in this app, and a bee that simply is not there yet needs no
// fallback UI — it renders nothing until the chunk lands, a few ms later, which
// is indistinguishable from the bee not having flown in yet.
//
// The chunk stays in the service worker's precache list (swPrecache derives it
// from the emitted bundle, so this is automatic). That is the rule that makes
// deferring anything safe here: lazily loaded must still mean offline-available.

/** The resolved component once the chunk has landed, so later bees are sync. */
let loaded: Loaded = null;
/** The in-flight import, so summoning three bees at once makes one request. */
let pending: Promise<NonNullable<Loaded>> | null = null;

export function LazyBee(props: BeeProps) {
  // Both of these MUST wrap the component in a thunk. A component IS a function,
  // and React reads a bare function as "lazy initializer" in useState and as
  // "updater" in the setter — either way it calls it, with no props, and the
  // component throws on its own destructured arguments.
  const [Comp, setComp] = useState(() => loaded);

  useEffect(() => {
    if (Comp) return;
    let alive = true;
    pending ??= import('./Bee.tsx').then((m) => (loaded = m.Bee));
    pending.then((C) => alive && setComp(() => C));
    return () => {
      alive = false;
    };
  }, [Comp]);

  return Comp ? <Comp {...props} /> : null;
}
