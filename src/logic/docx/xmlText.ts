// ── TEXT → OOXML CHARACTER DATA ──────────────────────────────────────────────
// Everything the writer puts inside a <w:t> goes through here first.
//
// Escaping `& < >` is not enough. The buffer holds whatever the user typed or
// pasted, and a patent draft is very often pasted out of a PDF or an old
// word processor, which brings characters that simply cannot appear in an XML
// 1.0 document at all:
//
//   • C0 control characters other than tab/LF/CR (form feed is the common one —
//     PDF page breaks paste as \x0C)
//   • unpaired surrogates (a half-emoji left behind by a truncating copy)
//   • the non-characters U+FFFE / U+FFFF
//
// Writing one of those produces a document.xml no parser will accept, so Word
// refuses to open the exported file with "unreadable content" and the user
// loses the export entirely — with nothing to tell them which character did it.
// They carry no meaning in a patent text, so they are dropped.
//
// Carriage returns are dropped for a subtler reason: an XML parser normalizes a
// literal CR in character data to LF, so a CR written here would come back as a
// line break Word inserted on its own. Newlines are already expressed
// structurally (see runsFor), never as literal characters.

import { escapeMarkup } from '../escape.ts';

// Invalid in XML 1.0 character data, in the BMP. \t \n are kept (runsFor turns
// them into <w:tab/> / <w:br/> before they reach here, but keeping them makes
// this function safe to call on anything). \r is dropped, see above.
const INVALID_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\r\uFFFE\uFFFF]/g;

// A well-formed surrogate pair, or a lone surrogate. Matching the pair FIRST is
// what makes the lone case identifiable without a lookbehind (Safari only got
// those in 16.4, and this has to run in whatever browser the drafter has).
const SURROGATE_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/**
 * Drop the characters XML 1.0 cannot represent.
 */
export function stripInvalidXmlChars(s: string): string {
  const noControls = String(s).replace(INVALID_RE, '');
  // Fast path: no surrogate at all is the overwhelmingly common case.
  SURROGATE_RE.lastIndex = 0;
  if (!SURROGATE_RE.test(noControls)) return noControls;
  SURROGATE_RE.lastIndex = 0;
  return noControls.replace(SURROGATE_RE, (m) => (m.length === 2 ? m : ''));
}

/** Text ready to sit inside a `<w:t>`: XML-representable, then escaped. */
export const xmlText = (s: string): string => escapeMarkup(stripInvalidXmlChars(s));
