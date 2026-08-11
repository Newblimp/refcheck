import { useEffect } from 'react';
import { usePersistentState, oneOf } from './usePersistentState.ts';
import type { Dispatch, SetStateAction } from 'react';

/** The stored preference. 'system' follows the OS setting live. */
export type Theme = 'light' | 'dark' | 'system';

const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

// ── useTheme ─────────────────────────────────────────────────────────────────
// Theme preference ('light' | 'dark' | 'system'), persisted to rsc_theme and
// applied to <html data-theme>. The 'system' setting tracks the OS preference
// via matchMedia and follows live changes.
export function useTheme(): [Theme, Dispatch<SetStateAction<Theme>>] {
  const [theme, setTheme] = usePersistentState<Theme>('rsc_theme', 'dark', oneOf(THEMES, 'dark'));
  useEffect(() => {
    const apply = (t: string) => document.documentElement.setAttribute('data-theme', t);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const update = () => apply(mq.matches ? 'dark' : 'light');
      update();
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    apply(theme);
  }, [theme]);
  return [theme, setTheme];
}
