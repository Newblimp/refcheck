import { eachErrorSpan } from './errorSpans.ts';
import { escapeMarkup } from './escape.ts';
import { ERROR_KINDS } from './errorKinds.ts';
import type { Mode } from './constants.ts';
import type { Match } from './findText.ts';
import type { ArtError, BareTerm, ExtractResult, SignEntry, SignPosition } from './extract.ts';

// ── HTML BUILDER ────────────────────────────────────────────────────────────

// Highlight classes, paired with the error kinds they render. These names are a
// contract with styles.css — the pure logic layer has no other link to the
// stylesheet, so a rename there silently stops highlighting. A test asserts
// every class here is defined in styles.css.
//
// The sign severities are listed here because signs are not an ERROR_KINDS row
// (see errorKinds.ts); the four error categories bring their own class along, so
// adding a category cannot forget to add its highlight.
// Spelled out as constants as well as HL entries: mergeFind builds a class
// string from them, and HL is a Record<string, string> whose reads are
// `string | undefined` under noUncheckedIndexedAccess.
const FIND = 'h-find';
const FIND_CUR = 'h-find-cur';

export const HL: Record<string, string> = {
  warn: 'h-warn', // a sign with an inconsistency
  dis: 'h-dis', // a sign whose errors were dismissed
  ok: 'h-ok', // a consistent sign
  signTerm: 'h-wt', // the term attached to a warned sign
  focus: 'h-focus', // added to the sign the sidebar currently focuses
  find: FIND, // a Ctrl+F match
  findCur: FIND_CUR, // added to the one match the find bar is sitting on
  ...Object.fromEntries(ERROR_KINDS.map((k) => [k.id, k.hl])),
};

/** What the find bar wants highlighted: every match, and which one is current. */
export interface FindHighlight {
  matches: Match[];
  current: number;
}

/** A span as buildHtml emits it. */
interface Span {
  start: number;
  end: number;
  cls: string;
  sign?: string;
}

/**
 * Merge the find matches into the error spans, with the matches winning.
 *
 * They have to win outright rather than take their turn in the greedy
 * non-overlap pass below: a match that starts INSIDE an error mark ("using" in
 * a highlighted "housing") begins after that mark and so would be dropped by
 * it, and a search that silently fails to highlight some of its own hits is
 * worse than one that briefly hides an error colour. The error mark comes back
 * the moment the find bar closes.
 *
 * Both lists arrive sorted and internally non-overlapping, so the intersection
 * test is a single walk rather than a lookup per span.
 */
function mergeFind(spans: Span[], find: FindHighlight): Span[] {
  const { matches, current } = find;
  if (!matches.length) return spans;
  const out: Span[] = [];
  let j = 0;
  for (const e of spans) {
    // Matches that end before this span starts can never meet it, nor any span
    // after it — the spans are in document order too.
    let m = matches[j];
    while (m && m[1] <= e.start) m = matches[++j];
    if (!m || m[0] >= e.end) out.push(e);
  }
  for (const [i, m] of matches.entries())
    out.push({ start: m[0], end: m[1], cls: i === current ? `${FIND} ${FIND_CUR}` : FIND });
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Build the highlighted HTML for the backdrop overlay. Invariant: stripping the
 * <mark> tags from the output must reproduce escapeMarkup(text) exactly, or the backdrop
 * misaligns with the textarea (guarded by a test).
 * @param dis       Dismissal keys
 * @param focusSign Sign to mark with h-focus
 * @param find      Ctrl+F matches to highlight, and which one is current
 */
export function buildHtml(
  text: string,
  res: ExtractResult,
  mode: Mode,
  dis: Set<string>,
  focusSign: string | null,
  find: FindHighlight | null = null
): string {
  if (!text) return '';
  const spans: Span[] = [];
  eachErrorSpan(res, mode, dis, (sp) => {
    if (sp.kind === 'sign') {
      const cls = HL[sp.sev] ?? '';
      spans.push({
        start: sp.start,
        end: sp.end,
        cls: focusSign === sp.sign ? `${cls} ${HL.focus}` : cls,
        sign: sp.sign,
      });
    } else {
      spans.push({ start: sp.start, end: sp.end, cls: HL[sp.kind] ?? '' });
    }
  });
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const clean: Span[] = [];
  let cur = 0;
  for (const sp of spans) {
    if (sp.start >= cur) {
      clean.push(sp);
      cur = sp.end;
    }
  }
  const marks = find ? mergeFind(clean, find) : clean;
  let html = '',
    pos = 0;
  for (const sp of marks) {
    if (sp.start > pos) html += escapeMarkup(text.slice(pos, sp.start));
    const ds = sp.sign ? ` data-sign="${sp.sign}"` : '';
    html += `<mark class="${sp.cls}"${ds}>${escapeMarkup(text.slice(sp.start, sp.end))}</mark>`;
    pos = sp.end;
  }
  if (pos < text.length) html += escapeMarkup(text.slice(pos));
  // Vertical-alignment sentinel. A <textarea> reserves an empty line box for a
  // trailing "\n", but a white-space:pre-wrap div drops its final one — so a
  // buffer ending in a newline leaves the backdrop one line shorter than the
  // textarea, and scrolled to the bottom the highlights drift below the text
  // ("double text"). Append a newline the div will drop: it restores the
  // reserved line so both layers share one scrollHeight (a no-op when the text
  // does not end in a newline, since the div drops it either way).
  return html + '\n';
}

/** What the editor's context menu found under the caret. */
export type AtPos =
  | { type: 'art'; ae: ArtError }
  | { type: 'sign'; sign: string; pos: SignPosition }
  | { type: 'bare'; bt: BareTerm };

/**
 * What sits at a character position, for the editor's context menu.
 *
 * Bare terms are searched last and cannot overlap the sign spans anyway (a term
 * already attached to a sign is not bare), so the order only decides ties
 * between an article and the term behind it — which the article should win, as
 * before.
 */
export function findAtPos(
  charPos: number,
  signData: Record<string, SignEntry>,
  artErrors: ArtError[],
  bareTerms: BareTerm[] = []
): AtPos | null {
  for (const ae of artErrors)
    if (charPos >= ae.artStart && charPos <= ae.artEnd) return { type: 'art', ae };
  for (const [sign, sData] of Object.entries(signData))
    for (const p of sData.positions)
      if (charPos >= p.termStart && charPos <= p.signEnd) return { type: 'sign', sign, pos: p };
  for (const bt of bareTerms)
    if (charPos >= bt.termStart && charPos <= bt.termEnd) return { type: 'bare', bt };
  return null;
}
