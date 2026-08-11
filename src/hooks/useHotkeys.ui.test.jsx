import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { useHotkeys } from './useHotkeys.ts';

function Harness({ bindings, enabled }) {
  useHotkeys(bindings, enabled);
  return (
    <div>
      <textarea data-testid="ta" />
      <input data-testid="in" />
      <button data-testid="btn">b</button>
    </div>
  );
}

describe('useHotkeys', () => {
  it('fires a modified binding', () => {
    const fn = vi.fn();
    render(<Harness bindings={{ 'mod+]': fn }} />);
    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats Cmd as mod, for macOS', () => {
    const fn = vi.fn();
    render(<Harness bindings={{ 'mod+[': fn }} />);
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires a modified binding even from inside the editor', () => {
    // The editor holds focus almost all the time, so Ctrl+] has to work there.
    const fn = vi.fn();
    const { getByTestId } = render(<Harness bindings={{ 'mod+]': fn }} />);
    fireEvent.keyDown(getByTestId('ta'), { key: ']', ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('suppresses an unmodified binding while typing in a textarea or input', () => {
    // Otherwise a bare "/" binding makes the app impossible to type in.
    const fn = vi.fn();
    const { getByTestId } = render(<Harness bindings={{ '/': fn }} />);
    fireEvent.keyDown(getByTestId('ta'), { key: '/' });
    fireEvent.keyDown(getByTestId('in'), { key: '/' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires an unmodified binding outside a text field', () => {
    const fn = vi.fn();
    const { getByTestId } = render(<Harness bindings={{ '/': fn }} />);
    fireEvent.keyDown(getByTestId('btn'), { key: '/' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('matches named keys like Escape', () => {
    const fn = vi.fn();
    render(<Harness bindings={{ Escape: fn }} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive for letter keys', () => {
    const fn = vi.fn();
    render(<Harness bindings={{ 'mod+k': fn }} />);
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores unbound keys', () => {
    const fn = vi.fn();
    render(<Harness bindings={{ 'mod+]': fn }} />);
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const fn = vi.fn();
    render(<Harness bindings={{ 'mod+]': fn }} enabled={false} />);
    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('picks up a changed handler without re-binding the listener', () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(<Harness bindings={{ 'mod+]': a }} />);
    rerender(<Harness bindings={{ 'mod+]': b }} />);
    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('removes its listener on unmount', () => {
    const fn = vi.fn();
    const { unmount } = render(<Harness bindings={{ 'mod+]': fn }} />);
    unmount();
    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    expect(fn).not.toHaveBeenCalled();
  });
});
