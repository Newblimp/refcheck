import { describe, it, expect } from 'vitest';
import { detectLang, detectLangFromText } from './detectLang.js';

describe('detectLangFromText', () => {
  it('recognises German prose', () => {
    expect(detectLangFromText(
      'Die Vorrichtung 10 umfasst ein Gehäuse 12, wobei das Gehäuse 12 aus Aluminium besteht.'
    )).toBe('de');
  });
  it('recognises English prose', () => {
    expect(detectLangFromText(
      'The device 10 comprises a housing 12, wherein the housing 12 is made of aluminium.'
    )).toBe('en');
  });
  it('uses umlauts as a strong German signal on short text', () => {
    expect(detectLangFromText('Gehäuse Schlüssel Größe')).toBe('de');
  });
  it('defaults to English on empty input', () => {
    expect(detectLangFromText('')).toBe('en');
    expect(detectLangFromText(null)).toBe('en');
  });
});

describe('detectLang', () => {
  it('prefers the heading-derived language over the text', () => {
    // English-looking body, but the headings said German — headings win.
    const r = detectLang({ lang: 'de' }, 'The device 10 comprises a housing 12.');
    expect(r).toEqual({ lang: 'de', from: 'headings' });
  });
  it('falls back to text scoring when no heading matched', () => {
    const r = detectLang({ lang: null }, 'Die Vorrichtung 10 umfasst ein Gehäuse 12 und wird dadurch gehalten.');
    expect(r).toEqual({ lang: 'de', from: 'text' });
  });
  it('handles a missing split object', () => {
    expect(detectLang(null, 'The device 10 is shown.').lang).toBe('en');
  });
});
