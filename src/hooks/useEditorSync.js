import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { backdropScroll } from '../logic/scrollSync.js';

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

/**
 * @param {Object} opts
 * @param {string} opts.html  The backdrop's current markup — re-syncing keys off
 *   this, because it is what changes the backdrop's height.
 * @param {string} opts.text  The active buffer, for line counting in scrollTo.
 */
export function useEditorSync({ html, text }) {
  const taRef = useRef(null);
  const bdRef = useRef(null);
  const [hoverSign, setHoverSign] = useState(null);

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
  const syncScroll = useCallback(() => {
    const ta = taRef.current,
      bd = bdRef.current;
    if (!ta || !bd) return;
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
  useIsoLayoutEffect(() => {
    syncScroll();
  }, [html, syncScroll]);

  // Editor hover → sidebar-card highlight. elementFromPoint forces a synchronous
  // hit-test, so throttle to one lookup per animation frame instead of running
  // it on every mousemove.
  const hoverPending = useRef(false);
  const onEditorHover = useCallback((e) => {
    if (hoverPending.current) return;
    hoverPending.current = true;
    const x = e.clientX,
      y = e.clientY;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
    raf(() => {
      hoverPending.current = false;
      const ta = taRef.current;
      if (!ta) return;
      ta.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      ta.style.pointerEvents = '';
      const sign = el?.dataset?.sign || el?.closest?.('[data-sign]')?.dataset?.sign || null;
      setHoverSign((prev) => (prev === sign ? prev : sign));
    });
  }, []);

  // Hovering a sign highlights all of its marks in the editor. Doing that by
  // walking every mark in the document on each hover transition meant a
  // querySelectorAll plus a classList write per mark — thousands of them on a
  // real patent, for a pointer movement. Index the marks by sign once per
  // backdrop render, then touch only the outgoing and incoming sign's marks.
  const markIndex = useRef(new Map());
  const hoveredMarks = useRef(null);
  useIsoLayoutEffect(() => {
    const bd = bdRef.current;
    const index = new Map();
    if (bd) {
      for (const m of bd.querySelectorAll('mark[data-sign]')) {
        const s = m.dataset.sign;
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
    const next = hoverSign === null ? null : markIndex.current.get(hoverSign) || null;
    for (const m of next || []) m.classList.add('h-hover');
    hoveredMarks.current = next;
  }, [hoverSign, html]);

  /** Select [start, end] and scroll it into view. */
  const scrollTo = useCallback(
    (start, end) => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(start, end);
      // Measure the real line height instead of hardcoding it, so CSS changes and
      // browser zoom cannot desync click-to-navigate scrolling.
      let lh = parseFloat(getComputedStyle(ta).lineHeight);
      if (!Number.isFinite(lh)) lh = (parseFloat(getComputedStyle(ta).fontSize) || 13.5) * 1.75;
      const lines = textRef.current.slice(0, start).split('\n').length;
      ta.scrollTop = Math.max(0, (lines - 5) * lh);
      syncScroll();
    },
    [syncScroll]
  );

  // Put the caret back after an edit the app made on the user's behalf. The
  // textarea is controlled, so the new value only exists after this commit —
  // setting the selection inside the click handler would move it in the old one.
  const pendingCaret = useRef(null);
  const setCaretAfterCommit = useCallback((at) => {
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
