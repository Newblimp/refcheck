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
});

describe('findAtPos', () => {
  it('locates the sign at a character position', () => {
    const r = extractData('The housing 12 is large.', 'en');
    const at = findAtPos(13, r.signData, r.artErrors); // inside "12"
    expect(at?.type).toBe('sign');
    expect(at?.sign).toBe('12');
  });
});
