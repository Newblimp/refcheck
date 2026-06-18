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
    const conflict = x.signConflicts.find(s => s.sign === '12');
    expect(conflict.descTerms).toContain('housing');
    expect(conflict.claimsTerms).toContain('cover');
  });

  it('detects the same term mapped to different signs across buffers', () => {
    const d = desc('The housing 12 is large.');
    const c = claims('1. A housing (13).');
    const x = computeCrossRef(d, c);
    expect(x.termConflicts).toHaveLength(1);
    expect(x.termConflicts[0].rawTerm).toBe('housing');
    expect(x.termConflicts[0].descSigns).toEqual(['12']);
    expect(x.termConflicts[0].claimsSigns).toEqual(['13']);
  });

  it('sorts missing signs numerically rather than lexicographically', () => {
    const d = desc('The device 10 has a housing 12.');
    const c = claims('1. A device (10) with a housing (12), a part (2) and a part (100).');
    const x = computeCrossRef(d, c);
    expect(x.missingInDesc).toEqual(['2', '100']); // numeric, not '100' < '2'
  });

  it('does not flag a term whose sign matches in both buffers', () => {
    const d = desc('The housing 12 is large.');
    const c = claims('1. A housing (12).');
    const x = computeCrossRef(d, c);
    expect(x).toBeNull();
  });

  it('flags a claims sign that appears in the description only without a term', () => {
    // "(12)" in the description is standalone (no term) → noTermSigns.
    const d = desc('The device 10 has a part. See (12) in the drawing.');
    const c = claims('1. A device (10) with a housing (12).');
    const x = computeCrossRef(d, c);
    expect(x.notIntroducedInDesc).toEqual(['12']);
    expect(x.missingInDesc).toEqual([]); // present in desc (bare), so not "missing"
  });

  it('does not flag notIntroducedInDesc when the sign is properly introduced', () => {
    const d = desc('The device 10 has a housing 12.');
    const c = claims('1. A device (10) with a housing (12).');
    expect(computeCrossRef(d, c)).toBeNull();
  });
});
