import { describe, it, expect } from 'vitest';
import { extractData, classify, getAllErrors } from './extract.js';

// Raw terms recorded for a given sign (across all its term stems).
const rawTermsFor = (res, sign) =>
  Object.keys(res.signData[sign].terms).flatMap(ts => [...res.termData[ts].rawTerms]);

describe('extractData — consistency (description)', () => {
  const text = 'The device 10 comprises a housing 12 and a cover 14. ' +
    'The housing 12 is made of aluminium. ' +
    'The cover 14 is secured to the housing 12 by screws 18.';
  const res = extractData(text, 'en');

  it('detects exactly the expected signs', () => {
    expect(Object.keys(res.signData).sort()).toEqual(['10', '12', '14', '18']);
  });

  it('classifies every sign as consistent', () => {
    for (const sign of Object.keys(res.signData)) {
      expect(classify(sign, res.signData[sign], res.termData, 'description')).toBe('ok');
    }
  });
});

describe('extractData — inconsistencies', () => {
  it('flags one sign used with two different terms', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    expect(Object.keys(res.signData['12'].terms).length).toBe(2);
    expect(rawTermsFor(res, '12').sort()).toEqual(['casing', 'housing']);
    expect(classify('12', res.signData['12'], res.termData, 'description')).toBe('warn');
  });

  it('flags one term mapped to two different signs', () => {
    const res = extractData('The housing 12 is large. The housing 13 is small.', 'en');
    const stem = Object.keys(res.signData['12'].terms)[0];
    expect(Object.keys(res.termData[stem].signs).sort()).toEqual(['12', '13']);
    expect(classify('12', res.signData['12'], res.termData, 'description')).toBe('warn');
  });
});

describe('extractData — claims mode parentheses', () => {
  it('warns when a sign is not wrapped in parentheses', () => {
    const res = extractData('1. A device 10 comprising a housing (12).', 'en', {}, true, true);
    // 10 is bare (not in parens) → warn; 12 is in parens → ok
    expect(classify('10', res.signData['10'], res.termData, 'claims')).toBe('warn');
    expect(classify('12', res.signData['12'], res.termData, 'claims')).toBe('ok');
  });
});

describe('extractData — claim numbering', () => {
  const claims =
    '1. A device comprising a first component (1) and a second component (2).\n' +
    '2. The device according to claim 1, comprising a third component (3).\n' +
    '3. The device according to claim 1 or 2, comprising a fourth component (4).';

  it('does not turn claim numbers or "claim N" references into signs', () => {
    const res = extractData(claims, 'en', {}, true, true);
    expect(Object.keys(res.signData).sort()).toEqual(['1', '2', '3', '4']);
  });

  it('reports no numbering errors for a sequential list', () => {
    const res = extractData(claims, 'en', {}, true, true);
    expect(res.numErrors).toEqual([]);
  });

  it('every parenthesised sign is consistent in claims mode', () => {
    const res = extractData(claims, 'en', {}, true, true);
    for (const sign of Object.keys(res.signData)) {
      expect(classify(sign, res.signData[sign], res.termData, 'claims')).toBe('ok');
    }
  });

  it('flags an out-of-order / non-sequential numbering', () => {
    const bad =
      '1. A device (1).\n' +
      '2. A housing (2).\n' +
      '5. A cover (3).\n' +
      '4. A screw (4).';
    const res = extractData(bad, 'en', {}, true, true);
    expect(res.numErrors).toEqual([
      { value: 5, expected: 3, start: expect.any(Number), end: expect.any(Number) },
      { value: 4, expected: 6, start: expect.any(Number), end: expect.any(Number) },
    ]);
  });

  it('also recognises ")"-style claim numbering', () => {
    const res = extractData('1) A device (1).\n2) A housing (2).', 'en', {}, true, true);
    expect(Object.keys(res.signData).sort()).toEqual(['1', '2']);
    expect(res.numErrors).toEqual([]);
  });

  it('a leading claim number does not attach to the previous claim\'s trailing word', () => {
    const text = '1. A device (1) made of metal.\n2. The device (1) is heavy.';
    const res = extractData(text, 'en', {}, true, true);
    // Only sign 1 (the device); no spurious "metal" sign from the leading "2."
    expect(Object.keys(res.signData)).toEqual(['1']);
    expect(rawTermsFor(res, '1')).toContain('device');
  });

  it('contrast: without the claims flag the same leading number IS misread as a sign', () => {
    const text = '1. A device (1) made of metal.\n2. The device (1) is heavy.';
    const res = extractData(text, 'en', {}, true, false);
    expect(Object.keys(res.signData)).toContain('2'); // "metal 2" misread
  });
});

describe('extractData — article errors', () => {
  it('flags a definite article on first mention', () => {
    const res = extractData('The housing 12 is large.', 'en');
    expect(res.artErrors).toHaveLength(1);
    expect(res.artErrors[0].errType).toBe('first-def');
    expect(res.artErrors[0].article).toBe('the');
  });

  it('flags an indefinite article on a later mention', () => {
    const res = extractData('A housing 12 is provided. A housing 12 is large.', 'en');
    const repeat = res.artErrors.find(e => e.errType === 'repeat-indef');
    expect(repeat).toBeTruthy();
    expect(repeat.article).toBe('a');
  });
});

describe('extractData — bare terms', () => {
  it('flags a known term that appears without its sign', () => {
    const res = extractData('The housing 12 is shown. The housing is metallic.', 'en');
    expect(res.bareTerms.some(bt => bt.term === 'housing')).toBe(true);
  });
});

describe('getAllErrors', () => {
  it('aggregates and position-sorts active errors', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    const errs = getAllErrors(res.signData, res.termData, res.artErrors, res.bareTerms, res.numErrors, 'description', new Set());
    expect(errs.length).toBeGreaterThan(0);
    const starts = errs.map(e => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('omits dismissed signs', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    const errs = getAllErrors(res.signData, res.termData, res.artErrors, res.bareTerms, res.numErrors, 'description', new Set(['s:12']));
    expect(errs.some(e => e.type === 'sign' && e.sign === '12')).toBe(false);
  });
});
