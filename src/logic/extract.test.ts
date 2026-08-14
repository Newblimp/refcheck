import { describe, it, expect } from 'vitest';
import type { Lang } from './constants.ts';
import { must } from '../test/helpers.ts';
import type { ExtractResult } from './extract.ts';
import { extractData, classify, detectOrdStems } from './extract.ts';
import { getAllErrors } from './errorSpans.ts';
import { tokenize } from './tokenize.ts';
import { stem } from './stem.ts';
import { compareSigns } from './constants.ts';
import { listTermIndex } from './listTerms.ts';

// Raw terms recorded for a given sign (across all its term stems).
const rawTermsFor = (res: ExtractResult, sign: string): string[] =>
  Object.keys(res.signData[sign].terms).flatMap((ts) => [...res.termData[ts].rawTerms]);

describe('extractData — consistency (description)', () => {
  const text =
    'The device 10 comprises a housing 12 and a cover 14. ' +
    'The housing 12 is made of aluminium. ' +
    'The cover 14 is secured to the housing 12 by screws 18.';
  const res = extractData(text, 'en');

  it('detects exactly the expected signs', () => {
    expect(Object.keys(res.signData).sort()).toEqual(['10', '12', '14', '18']);
  });

  it('classifies every sign as consistent', () => {
    for (const sign of Object.keys(res.signData)) {
      expect(classify(res.signData[sign], res.termData, 'description')).toBe('ok');
    }
  });
});

describe('extractData — inconsistencies', () => {
  it('flags one sign used with two different terms', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    expect(Object.keys(res.signData['12'].terms).length).toBe(2);
    expect(rawTermsFor(res, '12').sort()).toEqual(['casing', 'housing']);
    expect(classify(res.signData['12'], res.termData, 'description')).toBe('warn');
  });

  it('flags one term mapped to two different signs', () => {
    const res = extractData('The housing 12 is large. The housing 13 is small.', 'en');
    const stem = Object.keys(res.signData['12'].terms)[0];
    expect(Object.keys(res.termData[stem].signs).sort()).toEqual(['12', '13']);
    expect(classify(res.signData['12'], res.termData, 'description')).toBe('warn');
  });
});

describe('extractData — claims mode parentheses', () => {
  it('warns when a sign is not wrapped in parentheses', () => {
    const res = extractData('1. A device 10 comprising a housing (12).', 'en', {}, true, true);
    // 10 is bare (not in parens) → warn; 12 is in parens → ok
    expect(classify(res.signData['10'], res.termData, 'claims')).toBe('warn');
    expect(classify(res.signData['12'], res.termData, 'claims')).toBe('ok');
  });
});

describe('extractData — parenthesised sign groups "(6, 12; 13)"', () => {
  it('registers every sign in the group under the shared term, all in parentheses', () => {
    const res = extractData('Klemme (6, 12; 13)', 'de', {}, true, true);
    // All three signs are captured (the ";" no longer swallows 13)…
    expect(Object.keys(res.signData).sort()).toEqual(['12', '13', '6']);
    // …under the one preceding term…
    for (const s of ['6', '12', '13'])
      expect(Object.keys(res.signData[s].terms)).toEqual(['klemm']);
    // …and every one counts as written in parentheses (inPC === count).
    for (const s of ['6', '12', '13']) expect(res.signData[s].inPC).toBe(res.signData[s].count);
  });

  it('does not treat a group containing a non-sign word as parenthesised (see 10)', () => {
    const res = extractData('the plate (see 10) and the cover 14.', 'en', {}, true, true);
    // "(see 10)" is not a pure sign group, so 10 is not registered as a bracketed sign.
    expect(res.signData['10']).toBeUndefined();
  });

  it('a semicolon between independent clauses is not merged into one list', () => {
    const res = extractData('The plate 12; a cover 14 is shown.', 'en');
    expect(Object.keys(res.signData['12'].terms)).toEqual(['plate']);
    expect(Object.keys(res.signData['14'].terms)).toEqual(['cover']);
  });

  it('a single-sign group (10) still counts as parenthesised', () => {
    const res = extractData('A device (10).', 'en', {}, true, true);
    expect(res.signData['10'].inPC).toBe(1);
    expect(classify(res.signData['10'], res.termData, 'claims')).toBe('ok');
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
      expect(classify(res.signData[sign], res.termData, 'claims')).toBe('ok');
    }
  });

  it('flags an out-of-order / non-sequential numbering', () => {
    const bad =
      '1. A device (1).\n' + '2. A housing (2).\n' + '5. A cover (3).\n' + '4. A screw (4).';
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

  it("a leading claim number does not attach to the previous claim's trailing word", () => {
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
    const repeat = must(res.artErrors.find((e) => e.errType === 'repeat-indef'));
    expect(repeat).toBeTruthy();
    expect(repeat.article).toBe('a');
  });
});

describe('extractData — bare terms', () => {
  it('flags a known term that appears without its sign', () => {
    const res = extractData('The housing 12 is shown. The housing is metallic.', 'en');
    expect(res.bareTerms.some((bt) => bt.term === 'housing')).toBe(true);
  });

  it('does NOT flag a term that always carries its sign', () => {
    const res = extractData('The housing 12 is shown. The housing 12 is metallic.', 'en');
    expect(res.bareTerms).toEqual([]);
  });

  it('records the signs associated with a bare term for the hint', () => {
    const res = extractData('The cover 14 is shown. The cover is removed.', 'en');
    const bare = must(res.bareTerms.find((bt) => bt.term === 'cover'));
    expect(bare.signs).toEqual(['14']);
  });

  it('does not flag a term that has never been associated with a sign', () => {
    // "metal" never appears with a sign, so termData has no entry for it.
    const res = extractData('The housing 12 is made of metal. The metal is hard.', 'en');
    expect(res.bareTerms.some((bt) => bt.term === 'metal')).toBe(false);
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
      'The first bearing 20 supports the shaft 22. The second bearing 21 is at the end.',
      'en'
    );
    expect(Object.keys(res.signData['20'].terms)).toEqual([
      stem('first', 'en') + ' ' + stem('bearing', 'en'),
    ]);
    expect(Object.keys(res.signData['21'].terms)[0]).toContain(stem('bearing', 'en'));
    // The two bearings are distinct multi-word terms, so neither is an inconsistency.
    expect(classify(res.signData['20'], res.termData, 'description')).toBe('ok');
    expect(classify(res.signData['21'], res.termData, 'description')).toBe('ok');
  });

  // German declines a modifier five ways and a draft uses all five. Only "-e"
  // and "-en" were listed for the qualifiers, so "ein oberes Gehäuse 12" was
  // recorded as plain "Gehäuse" while "das obere Gehäuse 12" was not — one sign,
  // two terms, reported as an inconsistency the drafter never wrote.
  it('widens a German term through every inflection of its qualifier', () => {
    // [sentence, the two words that must form the term]
    const cases: [string, [string, string]][] = [
      ['Das obere Gehäuse 12 ist gezeigt.', ['obere', 'Gehäuse']],
      ['Ein oberes Gehäuse 12 ist gezeigt.', ['oberes', 'Gehäuse']],
      ['Die Lage des oberen Gehäuses 12 ist fest.', ['oberen', 'Gehäuses']],
      ['Eine Vorrichtung mit oberem Gehäuse 12 ist gezeigt.', ['oberem', 'Gehäuse']],
      ['Die Vorrichtung weist einen linken Arm 20 auf.', ['linken', 'Arm']],
      ['Eine Vorrichtung mit rechtem Arm 22 ist gezeigt.', ['rechtem', 'Arm']],
      ['Ein anderes Rad 40 dreht sich.', ['anderes', 'Rad']],
      ['Ein zusätzliches Lager 50 ist vorgesehen.', ['zusätzliches', 'Lager']],
      ['Zwei äußere Ringe 30 sind gezeigt.', ['äußere', 'Ringe']],
    ];
    for (const [text, [mod, noun]] of cases) {
      const sign = must(text.match(/\d+/))[0];
      const res = extractData(text, 'de');
      // Expected stem computed, not spelled out: the stemmer owns that spelling
      // (it folds "anderes" to "and"), and what matters here is that BOTH words
      // are in the term rather than the noun alone.
      expect(Object.keys(res.signData[sign].terms), text).toEqual([
        [stem(mod, 'de'), stem(noun, 'de')].join(' '),
      ]);
    }
  });

  it('folds a shortened reference to a term written with any inflection', () => {
    // The point of the inflections: "Das Rad 40" is the left wheel, not a third
    // term, whichever ending introduced it.
    const res = extractData(
      'Das linke Rad 40 dreht. Ein rechtes Rad 42 dreht. Das Rad 40 ist montiert.',
      'de'
    );
    expect(Object.keys(res.signData['40'].terms)).toEqual(['link rad']);
    expect(classify(res.signData['40'], res.termData, 'description')).toBe('ok');
    expect(classify(res.signData['42'], res.termData, 'description')).toBe('ok');
  });

  it('honours a manual multi-word override (mwo)', () => {
    const res = extractData(
      'The control unit 10 is here. The control unit 10 again.',
      'en',
      { [stem('unit', 'en')]: 1 },
      false,
      false
    );
    expect(Object.keys(res.signData['10'].terms)).toEqual(['control unit']);
  });

  it('treats a single-word term as one word when no override applies', () => {
    const res = extractData('The control unit 10 is here.', 'en', {}, false, false);
    expect(Object.keys(res.signData['10'].terms)).toEqual([stem('unit', 'en')]);
  });

  // EXCL bars a word from being the BASE NOUN, not from qualifying one. Breaking
  // the backward walk on it unconditionally made "further" — which sits in both
  // EN_ORD and EXCL — dead vocabulary.
  describe('an excluded word may qualify a term but never be its base noun', () => {
    it('takes "a further shaft 20" as the two-word term "further shaft"', () => {
      const res = extractData('A further shaft 20 is provided. The further shaft 20 turns.', 'en');
      expect(Object.keys(res.signData['20'].terms)).toEqual(['further shaft']);
      expect(rawTermsFor(res, '20')).toEqual(['further shaft']);
      expect(classify(res.signData['20'], res.termData, 'description')).toBe('ok');
    });

    it('registers no term at all for "a further 200 rivets are needed"', () => {
      // "further" is the word closest to the sign, so 200 has no term: nothing
      // to highlight, and nothing to put in the reference list.
      const res = extractData('A further 200 rivets are needed.', 'en');
      expect(res.signData['200']).toBeUndefined();
      expect([...res.noTermSigns]).toEqual(['200']);
      expect(getAllErrors(res, 'description', new Set())).toEqual([]);
    });

    it('leaves the sign termless even mid-sentence, next to a real term', () => {
      const res = extractData('The device 10 needs further 200 rivets.', 'en');
      expect(Object.keys(res.signData)).toEqual(['10']);
      expect([...res.noTermSigns]).toEqual(['200']);
    });

    it('folds a later "the shaft 20" into the qualified term', () => {
      const res = extractData('A further shaft 20 is provided. The shaft 20 turns.', 'en');
      expect(Object.keys(res.signData['20'].terms)).toEqual(['further shaft']);
      expect(classify(res.signData['20'], res.termData, 'description')).toBe('ok');
    });

    it('still stops at an excluded word that is not a modifier', () => {
      // "said" and "comprising" are excluded and are not qualifiers, so the term
      // ends where they begin — the behaviour EXCL exists for.
      const said = extractData('Said upper housing 12 is shown.', 'en');
      expect(Object.keys(said.signData['12'].terms)).toEqual(['upper hous']);
      const comp = extractData('A device comprising shaft 20 is shown.', 'en');
      expect(Object.keys(comp.signData['20'].terms)).toEqual(['shaft']);
    });
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

// The drafter's own reference list already says which terms are multi-word, so
// the extraction reads them from it instead of making them hand-extend each one.
describe('multi-word terms from the reference list', () => {
  const LIST = '10 device\n30 control unit\n20 first bearing surface';
  const idx = listTermIndex(LIST, 'en');
  const UNIT = stem('unit', 'en');

  it('extends a term the list spells out', () => {
    const res = extractData('The control unit 30 is mounted.', 'en', {}, true, false, idx);
    expect(Object.keys(res.signData['30'].terms)).toEqual(['control unit']);
  });

  it('takes three-word terms too', () => {
    const res = extractData('The first bearing surface 20 is flat.', 'en', {}, true, false, idx);
    expect(Object.keys(res.signData['20'].terms)).toEqual([
      [stem('first', 'en'), stem('bearing', 'en'), stem('surface', 'en')].join(' '),
    ]);
  });

  it('leaves a term the list does not name that way alone', () => {
    // Only "control unit" is listed, so a "drive unit" keeps its base noun and
    // the two do not collapse into one term.
    const res = extractData(
      'The control unit 30 drives the drive unit 40.',
      'en',
      {},
      true,
      false,
      idx
    );
    expect(Object.keys(res.signData['30'].terms)).toEqual(['control unit']);
    expect(Object.keys(res.signData['40'].terms)).toEqual([UNIT]);
  });

  it('applies to bare occurrences, so a missing sign is reported for the full term', () => {
    const res = extractData(
      'The control unit 30 is mounted. The control unit is grey.',
      'en',
      {},
      true,
      false,
      idx
    );
    const bt = must(res.bareTerms.find((b) => b.termStem === 'control unit'));
    expect(bt).toBeTruthy();
    expect(bt.term).toBe('control unit');
    expect(bt.signs).toEqual(['30']);
  });

  it('applies in claims mode as well', () => {
    const res = extractData(
      '1. A device (10) comprising a control unit (30).',
      'en',
      {},
      true,
      true,
      idx
    );
    expect(Object.keys(res.signData['30'].terms)).toEqual(['control unit']);
  });

  it('is overridden by a manual reduction', () => {
    // "Reduce term" writes an explicit 0, which must win over the list — a
    // reduction that the next keystroke undoes is not a reduction at all.
    const res = extractData(
      'The control unit 30 is mounted.',
      'en',
      { [UNIT]: 0 },
      true,
      false,
      idx
    );
    expect(Object.keys(res.signData['30'].terms)).toEqual([UNIT]);
  });

  it('is overridden by a manual extension', () => {
    const res = extractData(
      'The rotary control unit 30 is mounted.',
      'en',
      { [UNIT]: 2 },
      true,
      false,
      idx
    );
    expect(Object.keys(res.signData['30'].terms)).toEqual(['rotari control unit']);
  });

  it('lets a manual reduction take back an ordinal-detected extension too', () => {
    const text = 'The first bearing 20 supports the shaft 22. The second bearing 21 is here.';
    expect(Object.keys(extractData(text, 'en').signData['20'].terms)).toEqual([
      stem('first', 'en') + ' ' + stem('bearing', 'en'),
    ]);
    const res = extractData(text, 'en', { [stem('bearing', 'en')]: 0 });
    expect(Object.keys(res.signData['20'].terms)).toEqual([stem('bearing', 'en')]);
  });

  it('keeps the ordinal detection for terms the list says nothing about', () => {
    const res = extractData(
      'The first bearing 20 supports the shaft 22. The second bearing 21 is here.',
      'en',
      {},
      true,
      false,
      idx
    );
    expect(Object.keys(res.signData['20'].terms)).toEqual([
      stem('first', 'en') + ' ' + stem('bearing', 'en'),
    ]);
  });

  it('extends German terms', () => {
    const de = listTermIndex('30 erstes Lager', 'de');
    const res = extractData('Das erste Lager 30 trägt die Welle 22.', 'de', {}, true, false, de);
    expect(Object.keys(res.signData['30'].terms)).toEqual([
      [stem('erstes', 'de'), stem('Lager', 'de')].join(' '),
    ]);
  });

  it('changes nothing when no index is passed', () => {
    const res = extractData('The control unit 30 is mounted.', 'en');
    expect(Object.keys(res.signData['30'].terms)).toEqual([UNIT]);
  });

  it('registers ranges under the extended term as well', () => {
    const res = extractData(
      'The control units 30, 32 and 34 are wired.',
      'en',
      {},
      true,
      false,
      idx
    );
    for (const s of ['30', '32', '34'])
      expect(Object.keys(res.signData[s].terms)).toEqual(['control unit']);
  });
});

// A term introduced with a numbering is commonly referred back to without it:
// "eine erste Welle 10 … die Wellen 10, 20 und 30". Read literally that is an
// inconsistent sign, an over-used term and an unintroduced definite article, all
// three of them artefacts. See logic/cumulative.ts for the rule and its limits.
describe('extractData — cumulative references (numbering dropped)', () => {
  const DE =
    'Die Vorrichtung umfasst eine erste Welle 10, eine zweite Welle 20 und eine dritte Welle 30.\n' +
    'Die Wellen 10, 20 und 30 sind koaxial zueinander angeordnet.';
  const EN =
    'The apparatus comprises a first shaft 10, a second shaft 20 and a third shaft 30.\n' +
    'The shafts 10, 20 and 30 are coaxial.';

  it('keeps the widened term as the sign’s only term (DE)', () => {
    const res = extractData(DE, 'de');
    const numbered = [stem('erste', 'de'), stem('Welle', 'de')].join(' ');
    expect(Object.keys(res.signData['10'].terms)).toEqual([numbered]);
    expect(classify(res.signData['10'], res.termData, 'description')).toBe('ok');
  });

  it('leaves the shortened form out of termData, so the noun keeps one sign', () => {
    const res = extractData(DE, 'de');
    // Without the rule, "well" would be a term of its own carrying sign 10 while
    // "erst well", "zweit well" and "dritt well" carry 10, 20 and 30.
    expect(res.termData[stem('Welle', 'de')]).toBeUndefined();
    expect(
      Object.keys(res.termData[[stem('erste', 'de'), stem('Welle', 'de')].join(' ')].signs)
    ).toEqual(['10']);
  });

  it('reports no error at all for the whole passage (DE and EN)', () => {
    for (const [text, lang] of [
      [DE, 'de'],
      [EN, 'en'],
    ] as [string, Lang][]) {
      const res = extractData(text, lang);
      expect(getAllErrors(res, 'description', new Set())).toEqual([]);
      expect(res.artErrors).toEqual([]);
      expect(res.bareTerms).toEqual([]);
    }
  });

  it('still counts the shortened occurrence, under the numbered term', () => {
    const res = extractData(EN, 'en');
    const s10 = res.signData['10'];
    expect(s10.count).toBe(2);
    const back = must(s10.positions.find((p) => p.term === 'shafts'));
    expect(back.termStem).toBe('first shaft'); // navigation and highlighting group it here
    expect(back.cumulative).toBe(true);
    expect(s10.positions.filter((p) => p.cumulative).length).toBe(1);
  });

  it('folds a back-reference written before the numbered introduction', () => {
    // The rule looks at the whole document, not at what has been read so far.
    const res = extractData(
      'The shafts 10, 20 are coaxial. A first shaft 10 and a second shaft 20 are provided.',
      'en'
    );
    expect(Object.keys(res.signData['10'].terms)).toEqual(['first shaft']);
    expect(getAllErrors(res, 'description', new Set())).toEqual([]);
  });

  it('does not let a plural back-reference read as a der/die/das conflict', () => {
    // German plurals take "die" whatever the singular's gender is, so folding
    // the occurrence WITHOUT keeping it out of the article check would invent a
    // gender conflict on every masculine or neuter term.
    const res = extractData(
      'Der erste Stab 10 ist lang. Der zweite Stab 20 ist kurz. Die Stäbe 10, 20 sind parallel.',
      'de'
    );
    expect(res.artErrors.filter((a) => a.errType === 'de-gender')).toEqual([]);
  });

  it('checks antecedent basis against the numbered term in claims mode', () => {
    const res = extractData(
      '1. An apparatus comprising a first shaft (10), a second shaft (20) and a third shaft (30).\n' +
        '2. The apparatus of claim 1, wherein the shafts (10), (20) and (30) are coaxial.',
      'en',
      {},
      true,
      true
    );
    expect(res.artErrors).toEqual([]);
    expect(classify(res.signData['10'], res.termData, 'claims')).toBe('ok');
  });

  it('still requires the shortened occurrence to be parenthesised in claims mode', () => {
    // The numbering rule says what the term IS, not how the sign may be written.
    const res = extractData(
      '1. An apparatus comprising a first shaft (10) and a second shaft (20).\n' +
        '2. The apparatus of claim 1, wherein the shafts 10, 20 are coaxial.',
      'en',
      {},
      true,
      true
    );
    expect(res.signData['10'].count).toBe(2);
    expect(res.signData['10'].inPC).toBe(1);
    expect(classify(res.signData['10'], res.termData, 'claims')).toBe('warn');
  });

  it('folds a dropped qualifier exactly like a dropped numbering', () => {
    // The vocabulary is one list: "upper"/"obere" behaves as "first"/"erste".
    const en = extractData('The upper housing 12 is shown. The housing 12 is metal.', 'en');
    expect(Object.keys(en.signData['12'].terms)).toEqual(['upper hous']);
    expect(classify(en.signData['12'], en.termData, 'description')).toBe('ok');
    const de = extractData(
      'Ein oberes Gehäuse 12 ist gezeigt. Das Gehäuse 12 besteht aus Metall.',
      'de'
    );
    expect(Object.keys(de.signData['12'].terms)).toHaveLength(1);
    expect(classify(de.signData['12'], de.termData, 'description')).toBe('ok');
  });

  it('takes the modifier from the drafter’s reference list too', () => {
    // Here nothing in the text makes "erste Welle" two words — the list does.
    const idx = listTermIndex('10 erste Welle', 'de');
    const res = extractData(
      'Die erste Welle 10 ist gelagert. Die Welle 10 rotiert.',
      'de',
      {},
      true,
      false,
      idx
    );
    expect(Object.keys(res.signData['10'].terms)).toEqual([
      [stem('erste', 'de'), stem('Welle', 'de')].join(' '),
    ]);
    expect(classify(res.signData['10'], res.termData, 'description')).toBe('ok');
  });
});

describe('extractData — cumulative references, cases that stay errors', () => {
  it('flags a CHANGED modifier — only a dropped one is forgiven', () => {
    // "das obere Gehäuse 12" and "das untere Gehäuse 12" cannot both be sign 12,
    // so there is no single term to fold the bare "Gehäuse 12" into either.
    const res = extractData(
      'Das obere Gehäuse 12 ist gezeigt. Das untere Gehäuse 12 ist unten. Das Gehäuse 12 ist aus Metall.',
      'de'
    );
    expect(Object.keys(res.signData['12'].terms).length).toBe(3);
    expect(classify(res.signData['12'], res.termData, 'description')).toBe('warn');
  });

  it('flags a shortened term the reference list spells out itself', () => {
    // "control unit" is two words because the drafter's own list says so, not
    // because a modifier widened it — writing "the unit 30" departs from the
    // declared vocabulary rather than abbreviating it.
    const idx = listTermIndex('30 control unit', 'en');
    const res = extractData(
      'The control unit 30 is mounted. The unit 30 fails.',
      'en',
      {},
      true,
      false,
      idx
    );
    expect(Object.keys(res.signData['30'].terms).sort()).toEqual(['control unit', 'unit']);
    expect(classify(res.signData['30'], res.termData, 'description')).toBe('warn');
  });

  it('flags a sign carrying two modifiers rather than folding one of them', () => {
    const res = extractData(
      'A first shaft 10 and a second shaft 10 are shown. The shaft 10 rotates.',
      'en'
    );
    expect(Object.keys(res.signData['10'].terms).sort()).toEqual([
      'first shaft',
      'second shaft',
      'shaft',
    ]);
    expect(classify(res.signData['10'], res.termData, 'description')).toBe('warn');
  });

  it('flags a genuinely different term under the same sign', () => {
    const res = extractData('A first shaft 10 is shown. The housing 10 is metal.', 'en');
    expect(classify(res.signData['10'], res.termData, 'description')).toBe('warn');
  });

  it('leaves a bare noun under a sign that never carried a modifier alone', () => {
    // Sign 30 is not "a third shaft" anywhere, so its "shaft" is its own term.
    const res = extractData('A first shaft 10 is shown. The shaft 30 is separate.', 'en');
    expect(Object.keys(res.signData['30'].terms)).toEqual(['shaft']);
    expect(Object.keys(res.signData['10'].terms)).toEqual(['first shaft']);
  });

  it('lets a manual reduction win over the rule, conflicts and all', () => {
    // "Reduce term" takes the numbering off every occurrence, so there is no
    // numbered form left to fold into and the signs really do share one term.
    const text = 'A first shaft 10, a second shaft 20. The shafts 10, 20 are coaxial.';
    expect(Object.keys(extractData(text, 'en').signData['10'].terms)).toEqual(['first shaft']);
    const res = extractData(text, 'en', { [stem('shaft', 'en')]: 0 });
    expect(Object.keys(res.signData['10'].terms)).toEqual(['shaft']);
    expect(Object.keys(res.termData['shaft'].signs).sort()).toEqual(['10', '20']);
    expect(classify(res.signData['10'], res.termData, 'description')).toBe('warn');
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
      'Die Vorrichtung 10 umfasst ein Gehäuse 12. Das Gehäuse 12 besteht aus Aluminium.',
      'de'
    );
    expect(Object.keys(res.signData).sort()).toEqual(['10', '12']);
    // Singular/plural German forms collapse, so 12 has a single term stem.
    expect(Object.keys(res.signData['12'].terms)).toHaveLength(1);
  });

  it('flags a German definite article on first mention', () => {
    const res = extractData('Das Gehäuse 12 ist groß.', 'de');
    const fd = must(res.artErrors.find((e) => e.errType === 'first-def'));
    expect(fd).toBeTruthy();
    expect(fd.article).toBe('das');
  });

  it('flags a German indefinite article on a later mention', () => {
    const res = extractData('Ein Gehäuse 12 ist da. Ein Gehäuse 12 ist hier.', 'de');
    const ri = must(res.artErrors.find((e) => e.errType === 'repeat-indef'));
    expect(ri).toBeTruthy();
    expect(ri.article).toBe('ein');
  });

  it('flags a German gender (der/die/das) conflict on the same term', () => {
    const res = extractData(
      'Der Deckel 14 ist da. Die Deckel 14 ist weg. Das Deckel 14 ist hier.',
      'de'
    );
    const gender = res.artErrors.filter((e) => e.errType === 'de-gender');
    expect(gender.map((e) => e.article)).toEqual(['die', 'das']);
    expect(gender[0].prevArt).toBe('der');
  });

  it('does not raise a gender conflict when the article is consistent', () => {
    const res = extractData('Der Deckel 14 ist da. Der Deckel 14 ist weg.', 'de');
    expect(res.artErrors.some((e) => e.errType === 'de-gender')).toBe(false);
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
    const res = extractData('The method comprises step I and step II. Step I is repeated.', 'en');
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
    expect(classify(res.signData['II'], res.termData, 'description')).toBe('warn');
  });

  it('does not misread a capitalised sentence-initial word as a Roman sign', () => {
    // "In" starts with a Roman letter but is a word, so it forms no sign.
    const res = extractData('In the housing 12 a bolt is fixed.', 'en');
    expect(Object.keys(res.signData)).toEqual(['12']);
  });
});

describe('extractData — sign ranges (endpoints only)', () => {
  const endpointsOnly = (text: string, lang: Lang = 'en') => {
    const res = extractData(text, lang);
    return Object.keys(res.signData).sort();
  };

  it('registers both endpoints of an English "to" range', () => {
    expect(endpointsOnly('The screws 18 to 22 hold the plate.')).toEqual(['18', '22']);
  });
  it('registers a German "bis" range', () => {
    expect(endpointsOnly('Die Schrauben 18 bis 22 halten die Platte.', 'de')).toEqual(['18', '22']);
  });
  it('shares the noun across a German "bis" range — "bis" is never the term', () => {
    const res = extractData('Die Schrauben 18 bis 22 halten die Platte.', 'de');
    expect(Object.keys(res.signData['18'].terms)).toEqual(['schraub']);
    expect(Object.keys(res.signData['22'].terms)).toEqual(['schraub']); // not "bis"
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
  it('does NOT register a range preceded by a German figure word (Figuren 14 und 15)', () => {
    const res = extractData('Wie in den Figuren 14 und 15 gezeigt.', 'de');
    expect(Object.keys(res.signData)).toEqual([]);
    expect(res.bareTerms).toEqual([]);
  });
  it('does NOT register a range preceded by an English figure word (figures 14 and 15)', () => {
    const res = extractData('As shown in figures 14 and 15.', 'en');
    expect(Object.keys(res.signData)).toEqual([]);
  });
  it('does NOT register a German claim cross-reference (Ansprüche/Ansprüchen … bis)', () => {
    // "Anspruch"/"Ansprüche"/"Ansprüchen" and the range word "bis" are all
    // excluded, so no claim number is mistaken for a sign or a term.
    expect(Object.keys(extractData('nach einem der Ansprüche 1 bis 4.', 'de').signData)).toEqual(
      []
    );
    expect(Object.keys(extractData('gemäß den Ansprüchen 1 bis 4.', 'de').signData)).toEqual([]);
  });
  it('does NOT register "um" as a term (German, "um 10 mm nach oben")', () => {
    const res = extractData('Das Element wird um 10 mm verschoben.', 'de');
    expect(Object.keys(res.signData)).toEqual([]);
  });
  it('does NOT register English approximation words as terms (about/approximately/around/roughly)', () => {
    expect(Object.keys(extractData('The gap is about 10 mm.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The gap is approximately 10 mm.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The gap is around 10 mm.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The gap is roughly 10 mm.', 'en').signData)).toEqual([]);
  });
  it('does NOT register "wesentlichen" as a term (German, "im Wesentlichen 10")', () => {
    const res = extractData('Das Bauteil ist im Wesentlichen 10 mm lang.', 'de');
    expect(Object.keys(res.signData)).toEqual([]);
  });
  it('does NOT register "substantially" as a term (English)', () => {
    const res = extractData('The part is substantially 10 mm long.', 'en');
    expect(Object.keys(res.signData)).toEqual([]);
  });
  it('does NOT register "maximal"/"minimal" as terms (German)', () => {
    expect(Object.keys(extractData('Der Abstand beträgt maximal 10 mm.', 'de').signData)).toEqual(
      []
    );
    expect(Object.keys(extractData('Der Abstand beträgt minimal 10 mm.', 'de').signData)).toEqual(
      []
    );
  });
  it('does NOT register "maximum"/"minimum"/"maximal"/"minimal" as terms (English)', () => {
    expect(Object.keys(extractData('The gap is maximum 10 mm.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The gap is minimum 10 mm.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The gap is maximal 10 mm.', 'en').signData)).toEqual([]);
    expect(Object.keys(extractData('The gap is minimal 10 mm.', 'en').signData)).toEqual([]);
  });
  it('DOES register "section" as a term (English, no longer excluded)', () => {
    expect(Object.keys(extractData('See section 10 for details.', 'en').signData)).toEqual(['10']);
  });
  it('does NOT register "paragraph" as a term (English, still excluded)', () => {
    expect(Object.keys(extractData('See paragraph 10 for details.', 'en').signData)).toEqual([]);
  });
  it('DOES register "Abschnitt"/"Absatz" as terms (German, no longer excluded)', () => {
    expect(Object.keys(extractData('Siehe Abschnitt 10 für Details.', 'de').signData)).toEqual([
      '10',
    ]);
    expect(Object.keys(extractData('Siehe Absatz 10 für Details.', 'de').signData)).toEqual(['10']);
  });
  it('does NOT register "bzw"/"beziehungsweise"/"usw" as terms (German, excluded)', () => {
    expect(Object.keys(extractData('Der Hebel bzw. 10 ist da.', 'de').signData)).toEqual([]);
    expect(Object.keys(extractData('Der Hebel beziehungsweise 10 ist da.', 'de').signData)).toEqual(
      []
    );
    expect(Object.keys(extractData('Schrauben, Muttern usw. 10 sind da.', 'de').signData)).toEqual(
      []
    );
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
    expect(endpointsOnly('The bolts 18, 20, 22 and 24 are used.')).toEqual([
      '18',
      '20',
      '22',
      '24',
    ]);
  });
  it('shares the one preceding term across every listed sign', () => {
    const res = extractData('The screws 18, 20 and 22 hold the plate.', 'en');
    const terms = ['18', '20', '22'].map((s) => Object.keys(res.signData[s].terms)[0]);
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
    expect(res.bareTerms.some((bt) => bt.termStem.includes('hous'))).toBe(true);
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
    expect(classify(res.signData['12'], res.termData, 'claims')).toBe('warn');
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
      '1. A device (10).\n' + '2. The device (10) of claim 1, wherein the seal (20) is provided.';
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
    const starts = errs.map((e) => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('omits dismissed signs', () => {
    const res = extractData('The housing 12 is connected to the casing 12.', 'en');
    const errs = getAllErrors(res, 'description', new Set(['s:12']));
    expect(errs.some((e) => e.type === 'sign' && e.sign === '12')).toBe(false);
  });

  it('aggregates all five error categories (sign, art, bare, num, dep)', () => {
    const text =
      '1. A device 10 according to claim 9.\n3. The housing 12 is here. The housing is metal.';
    const res = extractData(text, 'en', {}, true, true);
    const errs = getAllErrors(res, 'claims', new Set());
    const types = new Set(errs.map((e) => e.type));
    expect(types).toEqual(new Set(['sign', 'art', 'bare', 'num', 'dep']));
  });

  it('omits a dismissed numbering error by its stable key', () => {
    const text = '1. A device (1).\n3. A housing (2).';
    const res = extractData(text, 'en', {}, true, true);
    const ne = res.numErrors[0];
    const errs = getAllErrors(res, 'claims', new Set(['n:' + ne.key]));
    expect(errs.some((e) => e.type === 'num')).toBe(false);
  });

  it('omits a dismissed dependency error by its key', () => {
    const text = '1. A device (10) according to claim 9.';
    const res = extractData(text, 'en', {}, true, true);
    const de = res.depErrors[0];
    const errs = getAllErrors(res, 'claims', new Set(['d:' + de.key]));
    expect(errs.some((e) => e.type === 'dep')).toBe(false);
  });
});

describe('shared list connectors', () => {
  // The sign-list scan and the claim-reference parser had drifted apart: the
  // sign scan was missing or/oder/through, so only the first sign of "18 or 22"
  // was registered under the shared term. Both now share one vocabulary.
  it('registers both signs of an "or" list under the shared term', () => {
    const res = extractData('A device comprising the bearings 18 or 22.');
    expect(res.signData['18']).toBeDefined();
    expect(res.signData['22']).toBeDefined();
    expect(Object.keys(res.signData['22'].terms)[0]).toBe(Object.keys(res.signData['18'].terms)[0]);
  });

  it('handles the German "oder"', () => {
    const res = extractData('Eine Vorrichtung mit den Lagern 18 oder 22.', 'de');
    expect(res.signData['18']).toBeDefined();
    expect(res.signData['22']).toBeDefined();
  });

  it('handles "through" as a range word', () => {
    const res = extractData('A device comprising the bearings 18 through 22.');
    expect(res.signData['18']).toBeDefined();
    expect(res.signData['22']).toBeDefined();
  });

  it('still keeps distinct terms apart across a connector', () => {
    // The digit-connector-digit adjacency rule must survive the wider vocabulary:
    // a word between the connector and the second number means two terms.
    const res = extractData('A housing 12 or a cover 14 is provided.');
    expect(Object.keys(res.signData['12'].terms)).toEqual(['hous']);
    expect(Object.keys(res.signData['14'].terms)).toEqual(['cover']);
  });
});

describe('autoMW = false', () => {
  // Every other call site in the suite passes true or defaults, so the branch
  // that skips ordinal detection entirely was never executed by a test.
  const TEXT = 'A first bearing 20 supports the shaft. A second bearing 21 is at the end.';

  it('does not auto-extend ordinal terms when disabled', () => {
    const off = extractData(TEXT, 'en', {}, false, false);
    // Without ordinal detection both bearings collapse onto the same term...
    expect(Object.keys(off.signData['20'].terms)).toEqual(['bear']);
    expect(Object.keys(off.signData['21'].terms)).toEqual(['bear']);
  });

  it('auto-extends them when enabled', () => {
    const on = extractData(TEXT, 'en', {}, true, false);
    expect(Object.keys(on.signData['20'].terms)).toEqual(['first bear']);
    expect(Object.keys(on.signData['21'].terms)).toEqual(['second bear']);
  });

  it('still honours an explicit multi-word override with autoMW off', () => {
    const off = extractData(TEXT, 'en', { bear: 1 }, false, false);
    expect(Object.keys(off.signData['20'].terms)).toEqual(['first bear']);
  });
});

describe('bracketed paragraph numbers', () => {
  // The "bracket on either side" rule is subtle enough to pin directly rather
  // than only through its effect on a whole extraction.
  it('ignores a fully bracketed number', () => {
    const res = extractData('The housing [0012] is shown.');
    expect(res.signData['0012']).toBeUndefined();
  });

  it('ignores both members of a bracketed range', () => {
    const res = extractData('See the housing [0012]-[0015] for detail.');
    expect(res.signData['0012']).toBeUndefined();
    expect(res.signData['0015']).toBeUndefined();
  });

  it('ignores every member of a bracketed list', () => {
    const res = extractData('The housing [18, 20] is shown.');
    expect(res.signData['18']).toBeUndefined();
    expect(res.signData['20']).toBeUndefined();
  });

  it('still detects an unbracketed sign in the same sentence', () => {
    const res = extractData('The housing 12 is shown in paragraph [0012].');
    expect(res.signData['12']).toBeDefined();
    expect(res.signData['0012']).toBeUndefined();
  });

  it('does not let a bracketed number satisfy a bare term', () => {
    const res = extractData('A housing 12 is shown. The housing [0012] is aluminium.');
    expect(res.bareTerms.some((b) => b.termStem === 'hous')).toBe(true);
  });
});
