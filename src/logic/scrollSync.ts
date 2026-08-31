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
 * @param scrollTop     The textarea's reported scroll offset.
 * @param scrollHeight  The textarea's full content height.
 * @param clientHeight  The textarea's visible height.
 * @returns `top` to assign to the backdrop's scrollTop, and `shift`, the
 *   overscrolled remainder in px (negative past the top, positive past the
 *   bottom, 0 in the normal case).
 */
export function backdropScroll(
  scrollTop: number | undefined,
  scrollHeight: number | undefined,
  clientHeight: number | undefined
): { top: number; shift: number } {
  const st = Number.isFinite(scrollTop) ? (scrollTop as number) : 0;
  const max = Math.max(0, (scrollHeight || 0) - (clientHeight || 0));
  const top = Math.min(Math.max(st, 0), max);
  return { top, shift: st - top };
}

/**
 * Where to scroll so that a span sits roughly in the middle of the editor.
 *
 * Jumping to an error used to put it five lines from the top, computed from the
 * NUMBER OF NEWLINES before it — which is not where the line is. A patent
 * paragraph is one logical line that wraps over a dozen visual ones, so on a
 * real draft "five lines down" was hundreds of pixels short of the term and the
 * jump landed nowhere near it. Centring needs the span's measured position
 * instead (see useEditorSync), and this is the arithmetic on top of it: put the
 * middle of the span at the middle of the box, then clamp to the scroll range,
 * so a target in the first or last screenful simply stops at the end rather
 * than being pushed off it.
 *
 * @param top     Span offset from the top of the scrollable content, in px.
 * @param height  The span's own height (a wrapped span spans several lines).
 * @returns The scrollTop to assign.
 */
export function centerOffset(
  top: number,
  height: number,
  clientHeight: number,
  scrollHeight: number
): number {
  if (!Number.isFinite(top)) return 0;
  const box = Number.isFinite(clientHeight) ? clientHeight : 0;
  const h = Number.isFinite(height) ? height : 0;
  const max = Math.max(0, (Number.isFinite(scrollHeight) ? scrollHeight : 0) - box);
  // Centre the span itself, not its top edge: a term wrapped across two lines
  // would otherwise sit half a line low.
  return Math.min(Math.max(top - (box - h) / 2, 0), max);
}
