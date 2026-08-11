import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useEditorSync } from './useEditorSync.ts';

// The layer-alignment effect must not force layout at mount.
//
// Reading scrollTop/scrollHeight/clientHeight after a commit forces a synchronous
// layout, and at mount that layout is the app's first — the whole document. A
// Lighthouse trace of the deployed site attributed 46 ms of a 78 ms mount task to
// exactly this read, with Style & Layout the largest group in the profile, while
// the call itself had nothing to do: both layers sit at offset 0 until the editor
// is scrolled.
//
// So the invariant is behavioural, not cosmetic, and it is invisible to every
// other test here: count the geometry reads rather than the alignment they
// produce. The paste case the effect exists for is the second half — once the
// textarea HAS scrolled, a backdrop re-render must still re-mirror it.

let geometryReads = 0;
const GEOMETRY = ['scrollTop', 'scrollHeight', 'clientHeight'];

beforeEach(() => {
  geometryReads = 0;
  // Defined on the textarea prototype (shadowing Element's own definitions) so
  // the counter is in place before the component mounts — the read under test
  // happens in a layout effect during render().
  for (const prop of GEOMETRY) {
    Object.defineProperty(HTMLTextAreaElement.prototype, prop, {
      configurable: true,
      get() {
        geometryReads++;
        return 0;
      },
      set() {},
    });
  }
});

afterEach(() => {
  for (const prop of GEOMETRY)
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>)[prop];
});

function Harness({ html }: { html: string }) {
  const { taRef, bdRef, syncScroll } = useEditorSync({ html, text: 'the housing 12' });
  return (
    <div>
      <div ref={bdRef} data-testid="bd" dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={taRef}
        data-testid="ta"
        onScroll={syncScroll}
        readOnly
        value="the housing 12"
      />
    </div>
  );
}

describe('useEditorSync scroll mirroring', () => {
  it('reads no editor geometry at mount', () => {
    render(<Harness html="<mark data-sign='12'>12</mark>" />);
    expect(geometryReads).toBe(0);
  });

  it('still reads none when the backdrop re-renders before any scroll', () => {
    const { rerender } = render(<Harness html="<mark data-sign='12'>12</mark>" />);
    rerender(<Harness html="<mark data-sign='14'>14</mark>" />);
    expect(geometryReads).toBe(0);
  });

  it('mirrors the scroll position once the editor has scrolled', () => {
    const { getByTestId } = render(<Harness html="<mark data-sign='12'>12</mark>" />);
    act(() => void getByTestId('ta').dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(geometryReads).toBeGreaterThan(0);
  });

  it('re-mirrors on a later backdrop render, which is the large-paste case', () => {
    // A big paste scrolls the textarea to the caret before the debounced html
    // commits, so the one scroll event synced against stale, short content. The
    // re-sync after the content commits is what realigns the layers — gating it
    // on "has scrolled" must not cost that.
    const { getByTestId, rerender } = render(<Harness html="<mark data-sign='12'>12</mark>" />);
    act(() => void getByTestId('ta').dispatchEvent(new Event('scroll', { bubbles: true })));
    geometryReads = 0;
    rerender(<Harness html="<mark data-sign='14'>14</mark>" />);
    expect(geometryReads).toBeGreaterThan(0);
  });
});
