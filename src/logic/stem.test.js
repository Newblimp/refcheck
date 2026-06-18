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

describe('stemEn — Porter suffix steps', () => {
  it('strips -ing and -ed inflections to a common stem', () => {
    expect(stemEn('connecting')).toBe(stemEn('connected'));
    expect(stemEn('connecting')).toBe(stemEn('connection'));
    expect(stemEn('running')).toBe('run'); // undoubles -nn after -ing
  });
  it('collapses -y/-ies plurals (assembly/assemblies, body/bodies)', () => {
    expect(stemEn('assemblies')).toBe(stemEn('assembly'));
    expect(stemEn('bodies')).toBe(stemEn('body'));
  });
  it('does not strip a short -ss ending', () => {
    expect(stemEn('class')).toBe('class'); // 1a leaves -ss intact
  });
  it('returns very short words unchanged', () => {
    expect(stemEn('a')).toBe('a');
    expect(stemEn('be')).toBe('be');
  });
  it('keeps unrelated technical nouns distinct', () => {
    expect(stemEn('flange')).not.toBe(stemEn('housing'));
    expect(stemEn('bearing')).not.toBe(stemEn('shaft'));
  });
});

describe('stemDe — Snowball behaviour', () => {
  it('strips plural/case endings to a common stem', () => {
    expect(stemDe('Schrauben')).toBe(stemDe('Schraube'));
    expect(stemDe('Deckel')).toBe(stemDe('Deckel')); // no spurious stripping
  });
  it('normalises umlauts in the final stem', () => {
    // ä/ö/ü are folded to a/o/u after stemming
    expect(stemDe('Gehäuse')).not.toMatch(/[äöü]/);
  });
  it('lowercases regardless of input case', () => {
    expect(stemDe('GEHÄUSE')).toBe(stemDe('gehäuse'));
  });
});

describe('stem dispatch', () => {
  it('routes to the language-specific stemmer', () => {
    expect(stem('housing', 'en')).toBe(stemEn('housing'));
    expect(stem('Gehäuse', 'de')).toBe(stemDe('Gehäuse'));
  });
  it('defaults to the English stemmer for an unknown language', () => {
    expect(stem('housings', 'fr')).toBe(stemEn('housings'));
  });
});
