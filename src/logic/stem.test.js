import { describe, it, expect } from 'vitest';
import { stem, stemEn, stemDe } from './stem.js';

describe('stemEn', () => {
  it('collapses singular and plural to the same stem', () => {
    expect(stemEn('housings')).toBe(stemEn('housing'));
    expect(stemEn('covers')).toBe(stemEn('cover'));
    expect(stemEn('devices')).toBe(stemEn('device'));
  });
  it('lowercases input', () => {
    expect(stemEn('Housing')).toBe(stemEn('housing'));
  });
  it('keeps distinct words distinct', () => {
    expect(stemEn('housing')).not.toBe(stemEn('casing'));
  });
});

describe('stemDe', () => {
  it('lowercases and normalises eszett', () => {
    expect(stemDe('Größe')).toBe(stemDe('grosse'));
  });
  it('collapses a German plural to its singular stem', () => {
    expect(stemDe('Vorrichtungen')).toBe(stemDe('Vorrichtung'));
  });
});

describe('stem dispatch', () => {
  it('routes to the language-specific stemmer', () => {
    expect(stem('housing', 'en')).toBe(stemEn('housing'));
    expect(stem('Gehäuse', 'de')).toBe(stemDe('Gehäuse'));
  });
});
