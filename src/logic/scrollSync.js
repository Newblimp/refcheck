/**
 * Geometry for keeping the highlight backdrop glued to the textarea.
 *
 * The editor is two stacked layers: a transparent-text `<textarea>` the user
 * types into, and a `.backdrop` holding the same text with the highlight
 * marks. They are separate scroll containers, kept together by mirroring
 * `scrollTop`.
 *
 * That mirroring breaks at the very ends of the document. When a scroll
 * gesture continues past the top or the bottom, browsers with elastic
 * overscroll (macOS and iOS) rubber-band the textarea's content — it slides
 * past the end of its own scroll range and springs back. Assigning that
 * position to the backdrop cannot reproduce it, because the backdrop clamps
 * any value outside [0, scrollHeight - clientHeight]: the text bounces and
 * the highlights stay pinned to the edge of the box.
 *
 * So split the reported position into the part the backdrop can scroll to and
 * the overshoot it cannot, which the caller applies as a translation instead.
 * (`overscroll-behavior: none` in styles.css suppresses the rubber-band in the
 * first place; this covers the engines that report an out-of-range scrollTop
 * anyway — iOS Safari does — so the two layers stay locked either way.)
 *
 * @param {number} scrollTop     The textarea's reported scroll offset.
 * @param {number} scrollHeight  The textarea's full content height.
 * @param {number} clientHeight  The textarea's visible height.
 * @returns {{top: number, shift: number}} `top` to assign to the backdrop's
 *   scrollTop, `shift` the overscrolled remainder in px (negative past the
 *   top, positive past the bottom, 0 in the normal case).
 */
export function backdropScroll(scrollTop, scrollHeight, clientHeight) {
  const st = Number.isFinite(scrollTop) ? scrollTop : 0;
  const max = Math.max(0, (scrollHeight || 0) - (clientHeight || 0));
  const top = Math.min(Math.max(st, 0), max);
  return { top, shift: st - top };
}
