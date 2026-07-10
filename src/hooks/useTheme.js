import { useEffect } from 'react';
import { usePersistentState, oneOf } from './usePersistentState.js';

// ── useTheme ─────────────────────────────────────────────────────────────────
// Theme preference ('light' | 'dark' | 'system'), persisted to rsc_theme and
// applied to <html data-theme>. The 'system' setting tracks the OS preference
// via matchMedia and follows live changes.
export function useTheme() {
  const [theme, setTheme] = usePersistentState('rsc_theme', 'dark', oneOf(['light', 'dark', 'system'], 'dark'));
  useEffect(() => {
    const apply = t => document.documentElement.setAttribute('data-theme', t);
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
