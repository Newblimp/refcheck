import { useEffect, useState } from 'react';
import type { FunctionComponent } from 'preact';
import type { HelpDialogProps } from './HelpDialog.tsx';

type Loaded = FunctionComponent<HelpDialogProps> | null;

// The help screen is opened by an explicit click on the `?` button (or Ctrl+?),
// and most sessions never open it — but the dialog and its strings in both
// languages shipped in the eager chunk regardless. This defers both, the same
// way LazyBee defers the bee and useDocumentIO defers the .docx pipeline.
//
// Same two rules as those:
//   · a plain dynamic import, not React.lazy — there is no Suspense boundary
//     anywhere in this app, and a dialog that is not there for a frame needs no
//     fallback (rendering one would flash a second box behind the real one);
//   · the chunk stays in the service worker's precache list, which swPrecache
//     derives from the emitted bundle, so the help screen still opens offline.
//
// Unlike the bee, this one is a response to a click, so it also imports on
// hover/focus of the button — see App.jsx. By the time the click lands the
// chunk is usually already there, and after the first visit it is served from
// the precache either way.

/** The resolved component once the chunk has landed, so reopening is sync. */
let loaded: Loaded = null;
/** The in-flight import, so a hover followed by a click makes one request. */
let pending: Promise<NonNullable<Loaded>> | null = null;

/** Start the fetch without rendering anything (hover/focus on the opener). */
export function preloadHelpDialog() {
  pending ??= import('./HelpDialog.tsx').then((m) => (loaded = m.HelpDialog));
  return pending;
}

export function LazyHelpDialog(props: HelpDialogProps) {
  // The thunk is required: a component IS a function, and useState would call a
  // bare one as a lazy initializer, with no props.
  const [Comp, setComp] = useState(() => loaded);

  useEffect(() => {
    if (Comp) return;
    let alive = true;
    preloadHelpDialog().then((C) => alive && setComp(() => C));
    return () => {
      alive = false;
    };
  }, [Comp]);

  return Comp ? <Comp {...props} /> : null;
}
