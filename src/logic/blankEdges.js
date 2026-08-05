/**
 * How many blank lines sit at the start and end of `lines`.
 *
 * This one rule has two consumers that must agree exactly:
 *   • docSplit.toText  — trims blank edges when assembling a buffer from a .docx
 *   • docx/write.planEdits — must rebuild the identical line array to diff against
 *
 * They previously each had their own copy, joined only by a "mirror that here"
 * comment; changing one without the other silently corrupts round-trip export,
 * because the diff would line up against text the user never saw.
 *
 * @param {string[]} lines
 * @returns {{head: number, tail: number}} counts of blank lines at each edge
 */
export function blankEdges(lines) {
  let head = 0;
  while (head < lines.length && !lines[head].trim()) head++;
  let tail = 0;
  while (tail < lines.length - head && !lines[lines.length - 1 - tail].trim()) tail++;
  return { head, tail };
}

/** The lines with blank edges removed. */
export function trimBlankEdges(lines) {
  const { head, tail } = blankEdges(lines);
  return lines.slice(head, lines.length - tail);
}
