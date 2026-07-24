import { describe, it, expect } from 'vitest';
import { extractData } from './extract.js';
import { buildHtml, esc, findAtPos } from './buildHtml.js';

const EMPTY = { signData: {}, termData: {}, artErrors: [], bareTerms: [], numErrors: [], depErrors: [] };
const build = (text, mode, isClaims, dis = new Set(), focusSign = null) =>
  buildHtml(text, extractData(text, 'en', {}, true, isClaims), mode, dis, focusSign);

describe('esc', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;');
  });
});

describe('buildHtml', () => {
  it('returns an empty string for empty input', () => {
    expect(buildHtml('', EMPTY, 'description', new Set(), null)).toBe('');
  });

  it('wraps a warned sign in a mark and tags it with data-sign', () => {
    const html = build('The housing 12 is the casing 12.', 'description', false);
    expect(html).toContain('data-sign="12"');
    expect(html).toContain('h-warn');
  });

  it('does not highlight leading claim numbers as signs', () => {
    const claims =
      '1. A device comprising a first component (1) and a second component (2).\n' +
      '2. The device according to claim 1, comprising a third component (3).';
    const html = build(claims, 'claims', true);
    // The parenthesised signs are marked…
    expect(html).toContain('<mark');
    // …but a sequential numbering produces no h-num highlight on the leading "1."/"2.".
    expect(html).not.toContain('h-num');
  });

  it('highlights a numbering error with the h-num class', () => {
    const html = build('1. A device (1).\n3. A housing (2).', 'claims', true);
    expect(html).toContain('h-num');
  });

  it('highlights a bad claim dependency with the h-dep class', () => {
    const html = build('1. A device (10) according to claim 9.', 'claims', true);
    expect(html).toContain('h-dep');
  });

  it('renders a dismissed sign as h-dis rather than h-warn', () => {
    const html = build('The housing 12 is the casing 12.', 'description', false, new Set(['s:12']));
    expect(html).toContain('h-dis');
    expect(html).not.toContain('h-warn');
  });

  it('adds the h-focus class to the focused sign', () => {
    const html = build('The housing 12 is large.', 'description', false, new Set(), '12');
    expect(html).toContain('h-focus');
  });

  it('escapes HTML metacharacters in the surrounding (unmarked) text', () => {
    const html = build('a <b> housing 12 & more', 'description', false);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
  });

  it('produces non-overlapping, ascending marks', () => {
    const html = build('The housing 12 is the casing 12. A housing 12.', 'description', false);
    // Every <mark> should open before the next one — no nested marks.
    const opens = [...html.matchAll(/<mark/g)].map(m => m.index);
    const closes = [...html.matchAll(/<\/mark>/g)].map(m => m.index);
    expect(opens.length).toBe(closes.length);
    for (let i = 1; i < opens.length; i++) {
      expect(opens[i]).toBeGreaterThan(closes[i - 1]); // previous mark closed first
    }
  });

  // The backdrop overlay only lines up with the textarea if buildHtml never
  // adds, drops or reorders a character within the content. This invariant is
  // what every other highlighting feature silently depends on. A single
  // trailing "\n" sentinel is appended (see below) and stripped here before
  // comparison — it carries no content, only backdrop height.
  it('stripping the marks reproduces the escaped input exactly (alignment invariant)', () => {
    const stripMarks = html => html.replace(/<\/?mark[^>]*>/g, '');
    const samples = [
      'The device 10 comprises a housing 12 and a cover 14. The housing 12 is the casing 12.',
      '1. A device (10) according to claim 9.\n3. The device (10) of claim 1. The housing is here.',
      "a <b> & housing 12 — the screws 18 to 22, the arm 10' and the arm 10′.",
      'Die Vorrichtung 10 umfasst ein Gehäuse 12.\r\nDas Gehäuse 12 ist groß.',
      'Step I precedes substep I.1 and step II.',
    ];
    for (const text of samples) {
      for (const isClaims of [false, true]) {
        const r = extractData(text, 'en', {}, true, isClaims);
        const html = buildHtml(text, r, isClaims ? 'claims' : 'description', new Set(), null);
        expect(stripMarks(html)).toBe(esc(text) + '\n');
      }
    }
  });

  // A textarea reserves an empty line for a trailing "\n" that a pre-wrap div
  // drops; the appended sentinel newline keeps the backdrop the same height so
  // the highlights do not drift below the text at the bottom of the buffer.
  it('appends a trailing newline sentinel so the backdrop matches textarea height', () => {
    expect(buildHtml('abc', EMPTY, 'description', new Set(), null)).toBe('abc\n');
    expect(build('The housing 12 is large.\n', 'description', false).endsWith('\n')).toBe(true);
    // Empty input stays empty (nothing to scroll, no backdrop content).
    expect(buildHtml('', EMPTY, 'description', new Set(), null)).toBe('');
  });
});

describe('findAtPos', () => {
  it('locates the sign at a character position', () => {
    const r = extractData('The housing 12 is large.', 'en');
    const at = findAtPos(13, r.signData, r.artErrors); // inside "12"
    expect(at?.type).toBe('sign');
    expect(at?.sign).toBe('12');
  });

  it('locates an article error at its position', () => {
    const r = extractData('The housing 12 is large.', 'en'); // "The" → first-def
    const at = findAtPos(1, r.signData, r.artErrors); // inside "The"
    expect(at?.type).toBe('art');
    expect(at?.ae.article).toBe('the');
  });

  it('returns null when nothing is at the position', () => {
    const r = extractData('The housing 12 is large.', 'en');
    expect(findAtPos(999, r.signData, r.artErrors)).toBeNull();
  });
});
