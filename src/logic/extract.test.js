import { describe, it, expect } from 'vitest';
import { extractData, classify, getAllErrors, detectOrdStems } from './extract.js';
import { tokenize } from './tokenize.js';
import { stem } from './stem.js';
import { compareSigns } from './constants.js';

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
      { value: 5, expected: 3, start: expect.any(Number), end: expect.any(Number), key: '5#1' },
      { value: 4, expected: 6, start: expect.any(Number), end: expect.any(Number), key: '4#1' },
    ]);
  });

  it('handles CRLF (Windows) line endings', () => {
    const res = extractData('1. A device (10).\r\n3. A housing (12).', 'en', {}, true, true);
    expect(Object.keys(res.signData).sort()).toEqual(['10', '12']);
    expect(res.numErrors).toHaveLength(1);
    expect(res.numErrors[0].value).toBe(3);
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

  it('does NOT flag a term that always carries its sign', () => {
    const res = extractData('The housing 12 is shown. The housing 12 is metallic.', 'en');
    expect(res.bareTerms).toEqual([]);
  });

  it('records the signs associated with a bare term for the hint', () => {
    const res = extractData('The cover 14 is shown. The cover is removed.', 'en');
    const bare = res.bareTerms.find(bt => bt.term === 'cover');
    expect(bare.signs).toEqual(['14']);
  });

  it('does not flag a term that has never been associated with a sign', () => {
    // "metal" never appears with a sign, so termData has no entry for it.
    const res = extractData('The housing 12 is made of metal. The metal is hard.', 'en');
    expect(res.bareTerms.some(bt => bt.term === 'metal')).toBe(false);
  });
});

describe('detectOrdStems & multi-word terms', () => {
  it('detects an ordinal-led multi-word term stem', () => {
    const text = 'The first bearing 20 supports the shaft 22.';
    const stems = detectOrdStems(tokenize(text), 'en', text, false);
    expect(stems.has(stem('bearing', 'en'))).toBe(true);
  });

  it('auto-extends "first bearing" / "second bearing" into two-word terms', () => {
    const res = extractData(
      'The first bearing 20 supports the shaft 22. The second bearing 21 is at the end.', 'en');
    expect(Object.keys(res.signData['20'].terms)).toEqual([stem('first', 'en') + ' ' + stem('bearing', 'en')]);
    expect(Object.keys(res.signData['21'].terms)[0]).toContain(stem('bearing', 'en'));
    // The two bearings are distinct multi-word terms, so neither is an inconsistency.
    expect(classify('20', res.signData['20'], res.termData, 'description')).toBe('ok');
    expect(classify('21', res.signData['21'], res.termData, 'description')).toBe('ok');
  });

  it('honours a manual multi-word override (mwo)', () => {
    const res = extractData('The control unit 10 is here. The control unit 10 again.',
      'en', { [stem('unit', 'en')]: 1 }, false, false);
    expect(Object.keys(res.signData['10'].terms)).toEqual(['control unit']);
  });

  it('treats a single-word term as one word when no override applies', () => {
    const res = extractData('The control unit 10 is here.', 'en', {}, false, false);
    expect(Object.keys(res.signData['10'].terms)).toEqual([stem('unit', 'en')]);
  });

  it('does not learn a stem when the sign-preceding word is excluded', () => {
    const text = 'the first claim 20 is discussed.'; // "claim" ∈ EXCL
    expect(detectOrdStems(tokenize(text), 'en', text, false).size).toBe(0);
  });

  it('skips claim numbers in claims mode (no stem learned from "first bearing\\n1.")', () => {
    const text = 'the first bearing\n1. A device.';
    // Without the claims flag the line-leading "1" counts as a sign after "bearing".
    expect(detectOrdStems(tokenize(text), 'en', text, false).has(stem('bearing', 'en'))).toBe(true);
    expect(detectOrdStems(tokenize(text), 'en', text, true).size).toBe(0);
  });
});

describe('extractData — trailing-letter & standalone signs', () => {
  it('keeps 12a and 12b as distinct signs', () => {
    const res = extractData('The cover 12a is here. The cover 12b is there.', 'en');
    expect(Object.keys(res.signData).sort()).toEqual(['12a', '12b']);
  });

  it('ignores a number with no preceding term (e.g. after an excluded word)', () => {
    const res = extractData('See 10 and 20.', 'en');
    expect(Object.keys(res.signData)).toEqual([]);
  });
});

describe('extractData — German', () => {
  it('extracts signs and stems German terms', () => {
    const res = extractData(
      'Die Vorrichtung 10 umfasst ein Gehäuse 12. Das Gehäuse 12 besteht aus Aluminium.', 'de');
    expect(Object.keys(res.signData).sort()).toEqual(['10', '12']);
    // Singular/plural German forms collapse, so 12 has a single term stem.
    expect(Object.keys(res.signData['12'].terms)).toHaveLength(1);
  });

  it('flags a German definite article on first mention', () => {
    const res = extractData('Das Gehäuse 12 ist groß.', 'de');
    const fd = res.artErrors.find(e => e.errType === 'first-def');
    expect(fd).toBeTruthy();
    expect(fd.article).toBe('das');
  });

  it('flags a German indefinite article on a later mention', () => {
    const res = extractData('Ein Gehäuse 12 ist da. Ein Gehäuse 12 ist hier.', 'de');
    const ri = res.artErrors.find(e => e.errType === 'repeat-indef');
    expect(ri).toBeTruthy();
    expect(ri.article).toBe('ein');
  });

  it('flags a German gender (der/die/das) conflict on the same term', () => {
    const res = extractData('Der Deckel 14 ist da. Die Deckel 14 ist weg. Das Deckel 14 ist hier.', 'de');
    const gender = res.artErrors.filter(e => e.errType === 'de-gender');
    expect(gender.map(e => e.article)).toEqual(['die', 'das']);
    expect(gender[0].prevArt).toBe('der');
  });

  it('does not raise a gender conflict when the article is consistent', () => {
    const res = extractData('Der Deckel 14 ist da. Der Deckel 14 ist weg.', 'de');
    expect(res.artErrors.some(e => e.errType === 'de-gender')).toBe(false);
  });
});

describe('extractData — prime-notation signs', () => {
  it('treats a sign and its primed variant as distinct', () => {
    const res = extractData("The arm 10 and the arm 10' differ.", 'en');
    expect(Object.keys(res.signData).sort()).toEqual(['10', "10'"]);
  });
});

describe('extractData — Roman-numeral step signs', () => {
  it('detects Roman step numerals as signs, associated with their term', () => {
    const res = extractData(
      'The method comprises step I and step II. Step I is repeated.', 'en');
    expect(Object.keys(res.signData).sort(compareSigns)).toEqual(['I', 'II']);
    expect(rawTermsFor(res, 'I')).toContain('step');
  });

  it('detects a Roman substep (I.1) as a distinct sign from its parent step', () => {
    const res = extractData('The step I opens. The substep I.1 follows.', 'en');
    expect(Object.keys(res.signData).sort(compareSigns)).toEqual(['I', 'I.1']);
  });

  it('flags a Roman step used with two different terms as an inconsistency', () => {
    const res = extractData('The bracket II holds it. The clamp II holds it.', 'en');
    expect(Object.keys(res.signData['II'].terms).length).toBe(2);
    expect(classify('II', res.signData['II'], res.termData, 'description')).toBe('warn');
  });

  it('does not misread a capitalised sentence-initial word as a Roman sign', () => {
    // "In" starts with a Roman letter but is a word, so it forms no sign.
    const res = extractData('In the housing 12 a bolt is fixed.', 'en');
    expect(Object.keys(res.signData)).toEqual(['12']);
  });
});

describe('extractData — sign ranges (endpoints only)', () => {
  const endpointsOnly = (text, lang = 'en') => {
    const res = extractData(text, lang);
    return Object.keys(res.signData).sort();
  };

  it('registers both endpoints of an English "to" range', () => {
    expect(endpointsOnly('The screws 18 to 22 hold the plate.')).toEqual(['18', '22']);
  });
  it('registers a German "bis" range', () => {
    expect(endpointsOnly('Die Schrauben 18 bis 22 halten die Platte.', 'de')).toEqual(['18', '22']);
  });
  it('registers an English "and" list of two signs', () => {
    expect(endpointsOnly('The screws 18 and 22 are shown.')).toEqual(['18', '22']);
  });
  it('registers a German "und" list of two signs', () => {
    expect(endpointsOnly('Die Schrauben 18 und 22 sind gezeigt.', 'de')).toEqual(['18', '22']);
  });
  it('registers an en-dash and an ASCII-hyphen range', () => {
    expect(endpointsOnly('The screws 18–22 hold it.')).toEqual(['18', '22']);
    expect(endpointsOnly('The screws 18-22 hold it.')).toEqual(['18', '22']);
  });
  it('shares the preceding term across both endpoints and does not flag it as bare', () => {
    const res = extractData('The screws 18 to 22 hold the plate.', 'en');
    const term18 = Object.keys(res.signData['18'].terms)[0];
    const term22 = Object.keys(res.signData['22'].terms)[0];
    expect(term22).toBe(term18);
    expect(res.bareTerms).toEqual([]);
  });
  it('does NOT treat "a housing 12 and a cover 14" as a range (distinct terms survive)', () => {
    const res = extractData('a housing 12 and a cover 14.', 'en');
    const t12 = [...res.termData[Object.keys(res.signData['12'].terms)[0]].rawTerms];
    const t14 = [...res.termData[Object.keys(res.signData['14'].terms)[0]].rawTerms];
    expect(t12).toContain('housing');
    expect(t14).toContain('cover');
  });
  it('does NOT register a range whose preceding word is excluded (claims 1 to 5)', () => {
    const res = extractData('according to claims 1 to 5.', 'en');
    expect(Object.keys(res.signData)).toEqual([]);
  });

  it('registers all elements of a 3+ element comma list with a conjunction', () => {
    expect(endpointsOnly('The screws 18, 20 and 22 hold the plate.')).toEqual(['18', '20', '22']);
  });
  it('handles the Oxford comma (EN and DE)', () => {
    expect(endpointsOnly('The screws 18, 20, and 22 hold it.')).toEqual(['18', '20', '22']);
    expect(endpointsOnly('Die Schrauben 18, 20, und 22 halten.', 'de')).toEqual(['18', '20', '22']);
  });
  it('registers a German "und" comma list', () => {
    expect(endpointsOnly('Die Schrauben 18, 20 und 22 halten.', 'de')).toEqual(['18', '20', '22']);
  });
  it('registers a pure comma list with no conjunction (module 18, 20)', () => {
    expect(endpointsOnly('The module 18, 20 is shown.')).toEqual(['18', '20']);
  });
  it('registers a longer list of four signs', () => {
    expect(endpointsOnly('The bolts 18, 20, 22 and 24 are used.')).toEqual(['18', '20', '22', '24']);
  });
  it('shares the one preceding term across every listed sign', () => {
    const res = extractData('The screws 18, 20 and 22 hold the plate.', 'en');
    const terms = ['18', '20', '22'].map(s => Object.keys(res.signData[s].terms)[0]);
    expect(new Set(terms).size).toBe(1);
    expect(res.bareTerms).toEqual([]);
  });
});

describe('extractData — bracketed paragraph numbers ([0012])', () => {
  it('does not treat a bracketed number as a sign', () => {
    const res = extractData('[0012] The housing 12 is large.', 'en');
    expect(Object.keys(res.signData)).toEqual(['12']);
  });

  it('ignores a bracketed number even directly after a term word', () => {
    const res = extractData('As noted above [0023], the housing 12 is shown.', 'en');
    expect(Object.keys(res.signData)).toEqual(['12']);
    expect([...res.noTermSigns]).toEqual([]); // not even recorded as a bare sign
  });

  it('a bracketed number does not satisfy a term (bare-term flag still raised)', () => {
    const res = extractData('The housing 12 is shown. The housing [0014] is metallic.', 'en');
    expect(res.bareTerms.some(bt => bt.termStem.includes('hous'))).toBe(true);
  });

  it('a fully bracketed range/list registers no signs', () => {
    expect(Object.keys(extractData('The screws [18-22] hold it.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The screws [18, 20] hold it.', 'en').signData)).toEqual([]);
  });

  it('an unbracketed range next to bracketed paragraph numbers still works', () => {
    const res = extractData('[0012] The screws 18 to 22 hold the plate.', 'en');
    expect(Object.keys(res.signData).sort()).toEqual(['18', '22']);
  });

  it('ignores bracketed numbers in claims mode too', () => {
    const res = extractData('1. A device (10), see paragraph [0012].', 'en', {}, true, true);
    expect(Object.keys(res.signData)).toEqual(['10']);
  });
});

describe('extractData — noTermSigns', () => {
  it('records a standalone sign that never gets a term', () => {
    const res = extractData('See (10) here.', 'en');
    expect([...res.noTermSigns]).toContain('10');
    expect(Object.keys(res.signData)).toEqual([]);
  });
  it('does not record a sign that does have a term', () => {
    const res = extractData('The housing 12 is large.', 'en');
    expect([...res.noTermSigns]).toEqual([]);
  });
});

describe('classify — claims parentheses', () => {
  it('warns when a sign appears both inside and outside parentheses', () => {
    const res = extractData('1. A housing (12) and a housing 12.', 'en', {}, true, true);
    expect(res.signData['12'].count).toBe(2);
    expect(res.signData['12'].inPC).toBe(1);
    expect(classify('12', res.signData['12'], res.termData, 'claims')).toBe('warn');
  });
});

describe('extractData — per-claim antecedent basis (claims mode)', () => {
  it('does not flag a second independent claim re-introducing terms with "a"', () => {
    const text =
      '1. A device (10) comprising a housing (12).\n' +
      '2. The device (10) of claim 1, wherein the housing (12) is metal.\n' +
      '3. A device (10) comprising a housing (12) and a cover (14).';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toEqual([]);
  });

  it('flags "the" on a term never introduced in the claim chain', () => {
    const text =
      '1. A device (10).\n' +
      '2. The device (10) of claim 1, wherein the seal (20) is provided.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toHaveLength(1);
    expect(res.artErrors[0].errType).toBe('first-def');
    expect(res.artErrors[0].termStem).toBe(stem('seal', 'en'));
  });

  it('accepts "the" when the term was introduced in an ancestor claim', () => {
    const text =
      '1. A device (10) with a seal (20).\n' +
      '2. The device (10) of claim 1, wherein the seal (20) is round.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toEqual([]);
  });

  it('flags "the" when the term exists only in a sibling (non-ancestor) claim', () => {
    const text =
      '1. A device (10).\n' +
      '2. The device (10) of claim 1, with a seal (20).\n' +
      '3. The device (10) of claim 1, wherein the seal (20) is round.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toHaveLength(1);
    expect(res.artErrors[0].errType).toBe('first-def');
    expect(res.artErrors[0].termStem).toBe(stem('seal', 'en'));
  });

  it('flags re-introduction with "a" in a dependent claim', () => {
    const text =
      '1. A device (10) with a seal (20).\n' +
      '2. The device (10) of claim 1, wherein a seal (20) is round.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toHaveLength(1);
    expect(res.artErrors[0].errType).toBe('repeat-indef');
  });

  it('inherits antecedents through "any one of the preceding claims"', () => {
    const text =
      '1. A device (10).\n' +
      '2. The device (10) of claim 1, with a seal (20).\n' +
      '3. The device (10) according to any one of the preceding claims, wherein the seal (20) is round.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toEqual([]);
  });

  it('inherits antecedents transitively through the dependency chain', () => {
    const text =
      '1. A device (10) with a seal (20).\n' +
      '2. The device (10) of claim 1, wherein a housing (12) is provided.\n' +
      '3. The device (10) of claim 2, wherein the seal (20) touches the housing (12).';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.artErrors).toEqual([]); // seal comes from claim 1 via 3 → 2 → 1
  });

  it('falls back to document-position logic when the buffer has no claim numbers', () => {
    const res = extractData('The housing 12 is large.', 'en', {}, true, true);
    expect(res.artErrors).toHaveLength(1);
    expect(res.artErrors[0].errType).toBe('first-def');
  });
});

describe('extractData — claim dependency errors', () => {
  it('flags a reference to a nonexistent claim', () => {
    const text = '1. A device (10).\n2. The device (10) according to claim 5.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.depErrors).toHaveLength(1);
    expect(res.depErrors[0]).toMatchObject({ claim: 2, ref: 5, type: 'missing' });
    expect(text.slice(res.depErrors[0].start, res.depErrors[0].end)).toBe('5');
  });

  it('flags a forward reference to an existing claim', () => {
    const text = '1. A device (10) as in claim 2.\n2. The device (10) of claim 1.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.depErrors).toHaveLength(1);
    expect(res.depErrors[0]).toMatchObject({ claim: 1, ref: 2, type: 'forward' });
  });

  it('flags a self-reference', () => {
    const text = '1. A device (10).\n2. The device (10) according to claim 2.';
    const res = extractData(text, 'en', {}, true, true);
    expect(res.depErrors).toHaveLength(1);
    expect(res.depErrors[0]).toMatchObject({ claim: 2, ref: 2, type: 'self' });
  });

  it('reports no errors for well-formed dependencies (EN + DE, ranges, preceding)', () => {
    const en =
      '1. A device (10).\n2. The device (10) of claim 1.\n' +
      '3. The device (10) according to claim 1 or 2.\n' +
      '4. The device (10) according to any one of claims 1 to 3.\n' +
      '5. The device (10) according to any one of the preceding claims.';
    expect(extractData(en, 'en', {}, true, true).depErrors).toEqual([]);
    const de =
      '1. Vorrichtung (10).\n2. Vorrichtung (10) nach Anspruch 1.\n' +
      '3. Vorrichtung (10) nach einem der Ansprüche 1 bis 2.\n' +
      '4. Vorrichtung (10) nach einem der vorhergehenden Ansprüche.';
    expect(extractData(de, 'de', {}, true, true).depErrors).toEqual([]);
  });

  it('returns empty depErrors in description mode', () => {
    const res = extractData('The device 10 according to claim 5.', 'en');
    expect(res.depErrors).toEqual([]);
  });
});

describe('getAllErrors', () => {
  it('aggregates and position-sorts active errors', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    const errs = getAllErrors(res, 'description', new Set());
    expect(errs.length).toBeGreaterThan(0);
    const starts = errs.map(e => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('omits dismissed signs', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    const errs = getAllErrors(res, 'description', new Set(['s:12']));
    expect(errs.some(e => e.type === 'sign' && e.sign === '12')).toBe(false);
  });

  it('aggregates all five error categories (sign, art, bare, num, dep)', () => {
    const text = '1. A device 10 according to claim 9.\n3. The housing 12 is here. The housing is metal.';
    const res = extractData(text, 'en', {}, true, true);
    const errs = getAllErrors(res, 'claims', new Set());
    const types = new Set(errs.map(e => e.type));
    expect(types).toEqual(new Set(['sign', 'art', 'bare', 'num', 'dep']));
  });

  it('omits a dismissed numbering error by its stable key', () => {
    const text = '1. A device (1).\n3. A housing (2).';
    const res = extractData(text, 'en', {}, true, true);
    const ne = res.numErrors[0];
    const errs = getAllErrors(res, 'claims', new Set(['n:' + ne.key]));
    expect(errs.some(e => e.type === 'num')).toBe(false);
  });

  it('omits a dismissed dependency error by its key', () => {
    const text = '1. A device (10) according to claim 9.';
    const res = extractData(text, 'en', {}, true, true);
    const de = res.depErrors[0];
    const errs = getAllErrors(res, 'claims', new Set(['d:' + de.key]));
    expect(errs.some(e => e.type === 'dep')).toBe(false);
  });
});
