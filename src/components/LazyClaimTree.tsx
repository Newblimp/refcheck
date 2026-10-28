import { useEffect, useState } from 'react';
import type { FunctionComponent } from 'preact';
import type { ClaimTreeProps } from './ClaimTree.tsx';

type Loaded = FunctionComponent<ClaimTreeProps> | null;

// The claim tree is drawn in claims mode only, yet its component and layout
// would otherwise ride the entry chunk for every visit (~1.1 KB gzipped). This
// defers both — the same treatment as LazyHelpDialog and LazyBee, and on the
// same two rules: a plain dynamic import rather than React.lazy (there is no
// Suspense boundary in this app; a panel that is empty for a frame needs no
// fallback), and the chunk stays in the service worker's precache list, which
// swPrecache derives from the emitted bundle — so it still draws offline.

/** The resolved component once the chunk has landed, so a remount is sync. */
let loaded: Loaded = null;
/** The in-flight import, shared by every mount that asks before it lands. */
let pending: Promise<NonNullable<Loaded>> | null = null;

const load = () => (pending ??= import('./ClaimTree.tsx').then((m) => (loaded = m.ClaimTree)));

export function LazyClaimTree(props: ClaimTreeProps) {
  // The thunk is required: a component IS a function, and useState would call a
  // bare one as a lazy initializer, with no props.
  const [Comp, setComp] = useState(() => loaded);

  useEffect(() => {
    if (Comp) return;
    let alive = true;
    load().then((C) => alive && setComp(() => C));
    return () => {
      alive = false;
    };
  }, [Comp]);

  return Comp ? <Comp {...props} /> : null;
}
