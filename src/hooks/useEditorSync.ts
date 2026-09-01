import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { backdropScroll, centerOffset } from '../logic/scrollSync.ts';

// ── useEditorSync ────────────────────────────────────────────────────────────
// Everything imperative about the two-layer editor: keeping the highlight
// backdrop aligned with the textarea, hit-testing hovers against it, scrolling
// to a span, and putting the caret back after an edit the app made itself.
//
// It lives here rather than in App because it is the one part of App that talks
// to the DOM directly — four effects, three refs and a rAF throttle that have
// nothing to do with the rest of App's state.

// useLayoutEffect on the client (runs before paint, so no highlight flash);
// plain useEffect on the server so the render smoke test logs no SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** A span's vertical placement inside the scrollable content, in px. */
interface SpanBox {
  top: number;
  height: number;
}

/**
 * The DOM range covering [start, end) of the backdrop's text.
 *
 * buildHtml's alignment invariant is what makes this a plain character walk:
 * stripping the marks reproduces the buffer exactly, so the concatenated text
 * nodes ARE the buffer and no mapping is needed. Returns null when the offsets
 * run past the end — the backdrop content is debounced, so on a large document
 * it can still be a keystroke behind the buffer these offsets came from.
 */
function rangeAt(bd: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(bd, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let sNode: Node | null = null,
    sOff = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.nodeValue?.length ?? 0;
    if (!sNode && start <= seen + len) {
      sNode = node;
      sOff = start - seen;
    }
    if (sNode && end <= seen + len) {
      const range = document.createRange();
      range.setStart(sNode, sOff);
      range.setEnd(node, end - seen);
      return range;
    }
    seen += len;
  }
  return null;
}

/**
 * Where [start, end) sits in the backdrop, or null if it cannot be measured.
 *
 * Null covers the environments that have no layout at all (jsdom reports every
 * rect as zero) as well as a backdrop whose content has not caught up, so the
 * caller always has to have an estimate to fall back on.
 */
function spanBox(bd: HTMLElement | null, start: number, end: number): SpanBox | null {
  if (!bd || typeof document === 'undefined' || typeof document.createRange !== 'function')
    return null;
  const range = rangeAt(bd, start, end);
  if (!range) return null;
  // jsdom implements Range but no layout at all — it has no
  // getBoundingClientRect to call, and every element rect it does report is
  // zero. Both are "cannot be measured here", so both fall through to the
  // estimate rather than throwing inside a click handler.
  if (typeof range.getBoundingClientRect !== 'function') return null;
  const r = range.getBoundingClientRect();
  if (!r || !r.height) return null;
  // Relative to the top of the scrollable content, so it can be handed straight
  // to scrollTop. Both rects carry the backdrop's overscroll translation, if
  // any, so it cancels in the subtraction.
  return { top: r.top - bd.getBoundingClientRect().top + bd.scrollTop, height: r.height };
}

/**
 * The pre-measurement estimate, kept only as a fallback: line height times the
 * number of newlines before the span. It is right for a document whose lines do
 * not wrap and low for one whose lines do, which is why it is no longer what
 * the jump is built on.
 */
function estimateBox(ta: HTMLTextAreaElement, start: number, text: string): SpanBox {
  // Measured rather than hardcoded, so CSS changes and browser zoom cannot
  // desync it further.
  let lh = parseFloat(getComputedStyle(ta).lineHeight);
  if (!Number.isFinite(lh)) lh = (parseFloat(getComputedStyle(ta).fontSize) || 13.5) * 1.75;
  const lines = text.slice(0, start).split('\n').length;
  return { top: (lines - 1) * lh, height: lh };
}

/**
 * @param html The backdrop's current markup — re-syncing keys off this, because
 *   it is what changes the backdrop's height.
 * @param text The active buffer, for scrollTo's fallback estimate.
 */
export function useEditorSync({ html, text }: { html: string; text: string }) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const bdRef = useRef<HTMLDivElement | null>(null);
  const [hoverSign, setHoverSign] = useState<string | null>(null);

  // Live mirror of the buffer, so scrollTo can stay a stable identity.
  const textRef = useRef(text);
  textRef.current = text;

  // Mirror the textarea's scroll position onto the backdrop. At the ends of
  // the document an elastic-overscroll browser slides the textarea's content
  // past its own scroll range and springs it back; the backdrop clamps that
  // position, so the text bounced while the highlights sat pinned to the edge.
  // styles.css turns the rubber-band off, and the overshoot the geometry still
  // reports (iOS Safari puts it in scrollTop) is applied as a translation,
  // which the backdrop's scrollTop cannot express. See logic/scrollSync.js.
  // Whether the editor has ever scrolled. Every path into syncScroll implies it
  // has: the textarea's own onScroll event, scrollTo (which just moved it), and
  // the effect below, which is gated on this flag. See the effect for why the
  // flag is tracked rather than measured.
  const scrolled = useRef(false);

  const syncScroll = useCallback(() => {
    const ta = taRef.current,
      bd = bdRef.current;
    if (!ta || !bd) return;
    scrolled.current = true;
    const { top, shift } = backdropScroll(ta.scrollTop, ta.scrollHeight, ta.clientHeight);
    bd.scrollTop = top;
    const tf = shift ? `translateY(${-shift}px)` : '';
    if (bd.style.transform !== tf) bd.style.transform = tf;
  }, []);

  // Re-mirror the scroll position whenever the backdrop's highlight content
  // (re-)renders. On a large paste the textarea scrolls to the caret at once,
  // but the backdrop html is debounced (≥5000 chars) — so the single scroll
  // event that fired synced against stale, short content and clamped, leaving
  // the highlights shifted until the next manual scroll. Re-syncing after the
  // content commits realigns the two layers before the browser paints.
  //
  // Skipped until the editor has actually scrolled, which is the whole of the
  // mount case: both layers sit at offset 0 with no transform, so there is
  // nothing to mirror. Asking the DOM to confirm that is what costs — the read
  // of scrollTop/scrollHeight/clientHeight forces the app's ENTIRE first layout
  // synchronously inside the mount task (46 ms of a 78 ms task, in a Lighthouse
  // trace of the deployed site, and the largest main-thread group in it). The
  // layout still has to happen; gating on a flag we already know lets the
  // browser do it in its own rendering step instead of inside our JS.
  //
  // The paste case is unaffected, because its ordering is the premise of the
  // bug above: the textarea scrolls to the caret BEFORE the debounced html
  // commits, so the flag is set by the time this effect needs it.
  useIsoLayoutEffect(() => {
    if (scrolled.current) syncScroll();
  }, [html, syncScroll]);

  // Editor hover → sidebar-card highlight. elementFromPoint forces a synchronous
  // hit-test, so throttle to one lookup per animation frame instead of running
  // it on every mousemove.
  const hoverPending = useRef(false);
  const onEditorHover = useCallback((e: { clientX: number; clientY: number }) => {
    if (hoverPending.current) return;
    hoverPending.current = true;
    const x = e.clientX,
      y = e.clientY;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16);
    raf(() => {
      hoverPending.current = false;
      const ta = taRef.current;
      if (!ta) return;
      ta.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      ta.style.pointerEvents = '';
      const hit = el instanceof HTMLElement ? el : null;
      const sign =
        hit?.dataset.sign || hit?.closest<HTMLElement>('[data-sign]')?.dataset.sign || null;
      setHoverSign((prev) => (prev === sign ? prev : sign));
    });
  }, []);

  // Hovering a sign highlights all of its marks in the editor. Doing that by
  // walking every mark in the document on each hover transition meant a
  // querySelectorAll plus a classList write per mark — thousands of them on a
  // real patent, for a pointer movement. Index the marks by sign once per
  // backdrop render, then touch only the outgoing and incoming sign's marks.
  const markIndex = useRef<Map<string, HTMLElement[]>>(new Map());
  const hoveredMarks = useRef<HTMLElement[] | null>(null);
  useIsoLayoutEffect(() => {
    const bd = bdRef.current;
    const index = new Map<string, HTMLElement[]>();
    if (bd) {
      for (const m of bd.querySelectorAll<HTMLElement>('mark[data-sign]')) {
        const s = m.dataset.sign;
        if (s === undefined) continue;
        const list = index.get(s);
        if (list) list.push(m);
        else index.set(s, [m]);
      }
    }
    markIndex.current = index;
    // The nodes just got replaced, so nothing carries the hover class any more.
    hoveredMarks.current = null;
  }, [html]);

  useEffect(() => {
    for (const m of hoveredMarks.current || []) m.classList.remove('h-hover');
    const next = hoverSign === null ? null : (markIndex.current.get(hoverSign) ?? null);
    for (const m of next || []) m.classList.add('h-hover');
    hoveredMarks.current = next;
  }, [hoverSign, html]);

  /**
   * Select [start, end] and scroll it to the middle of the editor.
   *
   * `focus` is false for the find bar, which steps through matches while the
   * drafter is still typing the query: taking focus back to the editor on every
   * keystroke would empty the search box's cursor out from under them. The
   * selection is still set, so closing the bar leaves the caret on the match.
   */
  const scrollTo = useCallback(
    (start: number, end: number, focus = true) => {
      const ta = taRef.current;
      if (!ta) return;
      if (focus) ta.focus();
      ta.setSelectionRange(start, end);
      // Where the span actually is, measured on the backdrop — the one layer
      // that has a DOM to measure. A <textarea> offers no way to ask where a
      // character sits, so this used to be estimated from the number of
      // NEWLINES before it: `(lines - 5) * lineHeight`. That is only the right
      // answer when no line wraps, and a patent paragraph is one logical line
      // wrapped over a dozen visual ones — so the jump landed a screenful or
      // more above the term, which reads exactly as "it scrolled somewhere, but
      // not to the highlight".
      //
      // The two layers are laid out identically by construction (same font,
      // same width, same wrapping — see styles.css and the Fonts note in
      // CLAUDE.md), and buildHtml guarantees the backdrop's text content is the
      // buffer character for character. So the backdrop's geometry IS the
      // textarea's.
      const box = spanBox(bdRef.current, start, end) ?? estimateBox(ta, start, textRef.current);
      ta.scrollTop = centerOffset(box.top, box.height, ta.clientHeight, ta.scrollHeight);
      syncScroll();
    },
    [syncScroll]
  );

  // Put the caret back after an edit the app made on the user's behalf. The
  // textarea is controlled, so the new value only exists after this commit —
  // setting the selection inside the click handler would move it in the old one.
  const pendingCaret = useRef<number | null>(null);
  const setCaretAfterCommit = useCallback((at: number) => {
    pendingCaret.current = at;
  }, []);
  useEffect(() => {
    const at = pendingCaret.current;
    if (at == null) return;
    pendingCaret.current = null;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(at, at);
  }, [text]);

  return {
    taRef,
    bdRef,
    hoverSign,
    setHoverSign,
    syncScroll,
    scrollTo,
    onEditorHover,
    setCaretAfterCommit,
  };
}
