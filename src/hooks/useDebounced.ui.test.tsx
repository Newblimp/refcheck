import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useDebounced } from './useDebounced.ts';

/** Renders the hook and records the value it returned on every render. */
interface ProbeProps {
  value: string;
  delay: number;
  initial?: string;
}

function harness(initialProps: ProbeProps) {
  const seen: string[] = [];
  let renders = 0;
  function Probe({ value, delay, initial }: ProbeProps) {
    renders++;
    seen.push(useDebounced(value, delay, initial));
    return null;
  }
  const view = render(<Probe {...initialProps} />);
  return {
    seen,
    renders: () => renders,
    set: (props: ProbeProps) => view.rerender(<Probe {...props} />),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebounced', () => {
  it('passes the value straight through when the delay is 0', () => {
    const h = harness({ value: 'a', delay: 0 });
    expect(h.seen.at(-1)).toBe('a');
    h.set({ value: 'b', delay: 0 });
    expect(h.seen.at(-1)).toBe('b');
  });

  it('costs no extra render at delay 0', () => {
    // The previous implementation round-tripped through state, wasting one
    // render per keystroke on every small document.
    const h = harness({ value: 'a', delay: 0 });
    const before = h.renders();
    h.set({ value: 'b', delay: 0 });
    expect(h.renders()).toBe(before + 1);
  });

  it('holds the old value until the input stops changing', () => {
    const h = harness({ value: 'a', delay: 200 });
    h.set({ value: 'ab', delay: 200 });
    act(() => void vi.advanceTimersByTime(150));
    h.set({ value: 'abc', delay: 200 });
    act(() => void vi.advanceTimersByTime(150));
    expect(h.seen.at(-1)).toBe('a');
    act(() => void vi.advanceTimersByTime(60));
    expect(h.seen.at(-1)).toBe('abc');
  });

  describe('deferred first render', () => {
    it('returns the placeholder on the first render of a big value', () => {
      // The boot case: a restored buffer would otherwise be extracted inside the
      // very first render, before anything at all was painted.
      const h = harness({ value: 'restored', delay: 200, initial: '' });
      expect(h.seen[0]).toBe('');
    });

    it('hands the real value over on the first effect, not after the delay', () => {
      // Waiting out the debounce would trade one stall for another.
      const h = harness({ value: 'restored', delay: 200, initial: '' });
      act(() => {});
      expect(h.seen.at(-1)).toBe('restored');
    });

    it('does not defer when the value is small enough to pass through', () => {
      // delay <= 0 is the caller's own "small document" test; deferring there
      // would cost a frame of missing highlights to save nothing.
      const h = harness({ value: 'small', delay: 0, initial: '' });
      expect(h.seen[0]).toBe('small');
    });

    // There is no test for a keystroke arriving BEFORE the handover: the mount
    // effect runs a frame after paint, which nothing can be typed inside, and
    // render() flushes it synchronously here in any case. A value that changed
    // in that window would be picked up by the ordinary debounce below.
    it('debounces normally once the deferred handover is done', () => {
      const h = harness({ value: 'restored', delay: 200, initial: '' });
      act(() => {});
      h.set({ value: 'edited', delay: 200, initial: '' });
      expect(h.seen.at(-1)).toBe('restored');
      act(() => void vi.advanceTimersByTime(250));
      expect(h.seen.at(-1)).toBe('edited');
    });
  });
});
