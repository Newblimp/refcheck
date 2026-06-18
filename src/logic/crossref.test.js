import { describe, it, expect } from 'vitest';
import { extractData } from './extract.js';
import { computeCrossRef } from './crossref.js';

const desc = txt => extractData(txt, 'en', {}, true, false);
const claims = txt => extractData(txt, 'en', {}, true, true);

describe('computeCrossRef', () => {
  it('returns null when a buffer is missing', () => {
    expect(computeCrossRef(null, claims('1. A device (1).'))).toBeNull();
  });

  it('returns null when the two buffers agree', () => {
    const d = desc('The device 10 has a housing 12.');
    const c = claims('1. A device (10) with a housing (12).');
    expect(computeCrossRef(d, c)).toBeNull();
  });

  it('lists signs present in claims but missing from the description', () => {
    const d = desc('The device 10 has a housing 12.');
    const c = claims('1. A device (10) with a housing (12) and a cover (14).');
    const x = computeCrossRef(d, c);
    expect(x.missingInDesc).toEqual(['14']);
    expect(x.missingInClaims).toEqual([]);
  });

  it('lists signs present in the description but missing from claims', () => {
    const d = desc('The device 10 has a housing 12 and a cover 14.');
    const c = claims('1. A device (10) with a housing (12).');
    const x = computeCrossRef(d, c);
    expect(x.missingInClaims).toEqual(['14']);
  });

  it('detects the same sign mapped to different terms across buffers', () => {
    const d = desc('The housing 12 is large.');
    const c = claims('1. A device with a cover (12).');
    const x = computeCrossRef(d, c);
    expect(x.signConflicts.map(s => s.sign)).toContain('12');
  });
});
