import { describe, it, expect } from 'vitest';
import { extractData } from './extract.js';
import { buildHtml, esc, findAtPos } from './buildHtml.js';

const build = (text, mode, isClaims) => {
  const r = extractData(text, 'en', {}, true, isClaims);
  return buildHtml(text, r.signData, r.termData, r.artErrors, r.bareTerms, r.numErrors, mode, new Set(), null);
};

describe('esc', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc('<a> & </a>')).toBe('&lt;a&gt; &amp; &lt;/a&gt;');
  });
});

describe('buildHtml', () => {
  it('returns an empty string for empty input', () => {
    expect(buildHtml('', {}, {}, [], [], [], 'description', new Set(), null)).toBe('');
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
    const bad = '1. A device (1).\n3. A housing (2).';
    const r = extractData(bad, 'en', {}, true, true);
    const html = buildHtml(bad, r.signData, r.termData, r.artErrors, r.bareTerms, r.numErrors, 'claims', new Set(), null);
    expect(html).toContain('h-num');
  });

  it('renders a dismissed sign as h-dis rather than h-warn', () => {
    const text = 'The housing 12 is the casing 12.';
    const r = extractData(text, 'en');
    const html = buildHtml(text, r.signData, r.termData, r.artErrors, r.bareTerms, r.numErrors,
      'description', new Set(['s:12']), null);
    expect(html).toContain('h-dis');
    expect(html).not.toContain('h-warn');
  });

  it('adds the h-focus class to the focused sign', () => {
    const text = 'The housing 12 is large.';
    const r = extractData(text, 'en');
    const html = buildHtml(text, r.signData, r.termData, r.artErrors, r.bareTerms, r.numErrors,
      'description', new Set(), '12');
    expect(html).toContain('h-focus');
  });

  it('escapes HTML metacharacters in the surrounding (unmarked) text', () => {
    const text = 'a <b> housing 12 & more';
    const r = extractData(text, 'en');
    const html = buildHtml(text, r.signData, r.termData, r.artErrors, r.bareTerms, r.numErrors,
      'description', new Set(), null);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
  });

  it('produces non-overlapping, ascending marks', () => {
    const text = 'The housing 12 is the casing 12. A housing 12.';
    const r = extractData(text, 'en');
    const html = buildHtml(text, r.signData, r.termData, r.artErrors, r.bareTerms, r.numErrors,
      'description', new Set(), null);
    // Every <mark> should open before the next one — no nested marks.
    const opens = [...html.matchAll(/<mark/g)].map(m => m.index);
    const closes = [...html.matchAll(/<\/mark>/g)].map(m => m.index);
    expect(opens.length).toBe(closes.length);
    for (let i = 1; i < opens.length; i++) {
      expect(opens[i]).toBeGreaterThan(closes[i - 1]); // previous mark closed first
    }
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
