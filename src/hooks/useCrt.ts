import { useCallback, useEffect } from 'react';
import { usePersistentState, oneOf } from './usePersistentState.ts';
import { crtReady, loadCrt } from '../crt/load.ts';

/** Whether the CRT screen filter is on. Stored as the attribute's own value. */
export type Crt = 'on' | 'off';

const CRT: readonly Crt[] = ['on', 'off'];

// ── useCrt ───────────────────────────────────────────────────────────────────
// The CRT screen filter: persisted to rsc_crt and applied as <html data-crt>,
// exactly the way useTheme applies data-theme. The attribute is the whole
// interface between this hook and the look — src/crt/crt.css hangs every rule
// off it, so switching the filter off leaves a loaded stylesheet matching
// nothing rather than needing anything to be torn down.
//
// The one thing it does that useTheme does not is wait for the stylesheet: the
// rules are a lazily-imported asset (see crt/load.ts), so the attribute is set
// only once they have landed. Setting it first would be a no-op for a moment
// and then snap into place, and — because the filter's power-on animation is
// keyed to the attribute appearing — would play that animation against an
// unstyled screen.
export function useCrt(): [Crt, () => void] {
  const [crt, setCrt] = usePersistentState<Crt>('rsc_crt', 'off', oneOf(CRT, 'off'));
  // Stable across renders (setCrt is a useState dispatch), because it is handed
  // to the memoized TopBar — a fresh identity here would re-render the whole bar
  // on every keystroke.
  const toggle = useCallback(() => setCrt((c) => (c === 'on' ? 'off' : 'on')), [setCrt]);

  useEffect(() => {
    const el = document.documentElement;
    if (crt === 'off') {
      el.removeAttribute('data-crt');
      return;
    }
    // Already fetched (a re-enable, or a hover that preloaded it): apply in this
    // same commit, so the toggle does not visibly lag its own button.
    if (crtReady()) {
      el.setAttribute('data-crt', 'on');
      return;
    }
    let alive = true;
    void loadCrt().then(() => {
      if (alive) el.setAttribute('data-crt', 'on');
    });
    return () => {
      alive = false;
    };
  }, [crt]);

  return [crt, toggle];
}

/** Start fetching the stylesheet without switching anything on (hover/focus). */
export const preloadCrt = () => void loadCrt();
