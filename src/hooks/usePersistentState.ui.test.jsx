import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { usePersistentState, jsonCodec, setCodec, oneOf } from './usePersistentState.ts';

describe('usePersistentState', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('initializes from localStorage, falling back to the initial value', () => {
    localStorage.setItem('k', 'stored');
    const { result } = renderHook(() => usePersistentState('k', 'fallback'));
    expect(result.current[0]).toBe('stored');

    const { result: missing } = renderHook(() => usePersistentState('absent', 'fallback'));
    expect(missing.current[0]).toBe('fallback');
  });

  it('writes immediately when no debounce is configured', () => {
    const { result } = renderHook(() => usePersistentState('k', ''));
    act(() => result.current[1]('typed'));
    expect(localStorage.getItem('k')).toBe('typed');
  });

  it('does not rewrite the value it just read on mount', () => {
    localStorage.setItem('k', 'stored');
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    renderHook(() => usePersistentState('k', ''));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('defers a debounced write and coalesces a burst into one', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => usePersistentState('k', '', undefined, { debounce: 400 }));

    act(() => result.current[1]('a'));
    act(() => result.current[1]('ab'));
    act(() => result.current[1]('abc'));
    // This is the point of the debounce: three keystrokes, nothing written yet.
    expect(spy).not.toHaveBeenCalled();
    expect(localStorage.getItem('k')).toBe(null);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(localStorage.getItem('k')).toBe('abc');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('flushes a pending write when the page is hidden', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePersistentState('k', '', undefined, { debounce: 400 }));
    act(() => result.current[1]('unsaved'));
    expect(localStorage.getItem('k')).toBe(null);

    // Closing the tab mid-debounce must not lose the text.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(localStorage.getItem('k')).toBe('unsaved');
  });

  it('flushes a pending write when the tab becomes hidden', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePersistentState('k', '', undefined, { debounce: 400 }));
    act(() => result.current[1]('unsaved'));

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(localStorage.getItem('k')).toBe('unsaved');
    spy.mockRestore();
  });

  it('reports a quota failure instead of silently dropping the write', async () => {
    const onError = vi.fn();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded', 'QuotaExceededError');
    });
    const { result } = renderHook(() => usePersistentState('k', '', undefined, { onError }));
    act(() => result.current[1]('too big'));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).toBeInstanceOf(DOMException);
    // State still updates — storage failure degrades to in-memory, it does not
    // block the user from typing.
    expect(result.current[0]).toBe('too big');
    spy.mockRestore();
  });

  it('survives localStorage being unavailable entirely', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    const { result } = renderHook(() => usePersistentState('k', 'fallback'));
    expect(result.current[0]).toBe('fallback');
    spy.mockRestore();
  });

  describe('codecs', () => {
    it('jsonCodec round-trips an object', () => {
      const { result } = renderHook(() => usePersistentState('k', {}, jsonCodec()));
      act(() => result.current[1]({ housing: 1 }));
      expect(localStorage.getItem('k')).toBe('{"housing":1}');
      const { result: reread } = renderHook(() => usePersistentState('k', {}, jsonCodec()));
      expect(reread.current[0]).toEqual({ housing: 1 });
    });

    it('setCodec round-trips a Set', () => {
      const { result } = renderHook(() => usePersistentState('k', new Set(), setCodec));
      act(() => result.current[1](new Set(['s:12'])));
      const { result: reread } = renderHook(() => usePersistentState('k', new Set(), setCodec));
      expect([...reread.current[0]]).toEqual(['s:12']);
    });

    it('oneOf rejects a hand-edited stored value', () => {
      localStorage.setItem('k', 'nonsense');
      const { result } = renderHook(() => usePersistentState('k', 'en', oneOf(['en', 'de'], 'en')));
      expect(result.current[0]).toBe('en');
    });
  });
});
