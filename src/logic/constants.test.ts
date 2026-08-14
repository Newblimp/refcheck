import { describe, it, expect } from 'vitest';
import {
  disKey,
  likelySign,
  isClaimNumber,
  isArt,
  isOrd,
  EN_ORD,
  DE_ORD,
  EXCL,
  artType,
  isSignToken,
  compareSigns,
  romanToInt,
  signVal,
} from './constants.ts';
import { tokenize } from './tokenize.ts';

describe('likelySign', () => {
  it('accepts 1–99999', () => {
    expect(likelySign('1')).toBe(true);
    expect(likelySign('10')).toBe(true);
    expect(likelySign('99999')).toBe(true);
    expect(likelySign('12a')).toBe(true); // parseInt ignores trailing letter
  });
  it('rejects 0 and out-of-range values', () => {
    expect(likelySign('0')).toBe(false);
    expect(likelySign('100000')).toBe(false);
  });
  it('treats a trailing letter as part of the same sign', () => {
    expect(likelySign('12b')).toBe(true);
    expect(likelySign('999a')).toBe(true);
  });
});

describe('isClaimNumber', () => {
  // Helper: find the token for the first occurrence of `word` in `text`.
  const tokFor = (text: string, word: string, occ = 0) => {
    const matches = tokenize(text).filter((t) => t.word === word);
    return matches[occ];
  };

  it('matches a line-leading number followed by a period', () => {
    const text = '1. A device';
    expect(isClaimNumber(text, tokFor(text, '1'))).toBe(true);
  });

  it('matches a line-leading number followed by a close-paren', () => {
    const text = '2) The device';
    expect(isClaimNumber(text, tokFor(text, '2'))).toBe(true);
  });

  it('matches an indented claim number', () => {
    const text = '\n   3. The device';
    expect(isClaimNumber(text, tokFor(text, '3'))).toBe(true);
  });

  it('does NOT match a reference sign in parentheses', () => {
    const text = 'a component (1).';
    expect(isClaimNumber(text, tokFor(text, '1'))).toBe(false);
  });

  it('does NOT match a mid-sentence "claim 1" reference', () => {
    const text = 'according to claim 1, comprising';
    expect(isClaimNumber(text, tokFor(text, '1'))).toBe(false);
  });

  it('does NOT match a line-leading number with no terminator', () => {
    const text = '10 housings were tested';
    expect(isClaimNumber(text, tokFor(text, '10'))).toBe(false);
  });

  it('does NOT treat a line-leading Roman step ("I.") as a claim number', () => {
    const text = 'I. Insert the pin.';
    expect(isClaimNumber(text, tokFor(text, 'I'))).toBe(false);
  });

  it('matches a claim number after a CRLF (Windows) line break', () => {
    const text = '1. A device.\r\n2. The device.';
    expect(isClaimNumber(text, tokFor(text, '2'))).toBe(true);
  });
});

describe('isSignToken', () => {
  it('accepts plain, lettered and primed signs', () => {
    expect(isSignToken('10')).toBe(true);
    expect(isSignToken('12a')).toBe(true);
    expect(isSignToken("10'")).toBe(true); // ASCII apostrophe
    expect(isSignToken('10′')).toBe(true); // U+2032 prime
  });
  it('rejects words, out-of-range and uppercase-suffixed numbers', () => {
    expect(isSignToken('housing')).toBe(false);
    expect(isSignToken('0')).toBe(false);
    expect(isSignToken('100000')).toBe(false);
    expect(isSignToken('12A')).toBe(false); // suffix letter is lowercase-only
  });
  it('accepts uppercase Roman-numeral steps and substeps', () => {
    expect(isSignToken('I')).toBe(true);
    expect(isSignToken('II')).toBe(true);
    expect(isSignToken('IX')).toBe(true);
    expect(isSignToken('XIV')).toBe(true);
    expect(isSignToken('I.1')).toBe(true);
    expect(isSignToken('IX.3')).toBe(true);
  });
  it('rejects malformed Roman numerals and lowercase forms', () => {
    expect(isSignToken('IIII')).toBe(false); // four I's is not valid
    expect(isSignToken('VV')).toBe(false);
    expect(isSignToken('ii')).toBe(false); // must be uppercase
    expect(isSignToken('I.')).toBe(false); // substep needs an Arabic numeral
  });
});

describe('romanToInt', () => {
  it('converts Roman numerals to their integer value', () => {
    expect(romanToInt('I')).toBe(1);
    expect(romanToInt('IV')).toBe(4);
    expect(romanToInt('IX')).toBe(9);
    expect(romanToInt('XIV')).toBe(14);
    expect(romanToInt('XL')).toBe(40);
  });
});

describe('signVal', () => {
  it('returns the Arabic integer for numeric signs (ignoring suffix)', () => {
    expect(signVal('10')).toBe(10);
    expect(signVal('12a')).toBe(12);
  });
  it('returns the Roman value, with substeps as a fractional minor', () => {
    expect(signVal('II')).toBe(2);
    expect(signVal('I.1')).toBeCloseTo(1.001);
    expect(signVal('II.3')).toBeCloseTo(2.003);
  });
});

describe('compareSigns', () => {
  it("orders numerically, then by suffix (10 < 10' < 10a < 12)", () => {
    const sorted = ['12', '10a', "10'", '10'].sort(compareSigns);
    expect(sorted).toEqual(['10', "10'", '10a', '12']);
  });
  it('does not collapse a primed sign to its bare number', () => {
    expect(compareSigns('10', "10'")).not.toBe(0);
  });
  it('orders Roman steps by value, with substeps after their parent step', () => {
    const sorted = ['II', 'IX', 'I', 'I.1', 'X'].sort(compareSigns);
    expect(sorted).toEqual(['I', 'I.1', 'II', 'IX', 'X']);
  });
  it('never interleaves Arabic and Roman signs: Arabic first, Roman grouped at the end', () => {
    const sorted = ['I', '2', 'X', '10', 'I.1', "10'", 'II'].sort(compareSigns);
    expect(sorted).toEqual(['2', '10', "10'", 'I', 'I.1', 'II', 'X']);
  });
});

describe('article helpers', () => {
  it('isArt recognises English and German articles', () => {
    expect(isArt('the', 'en')).toBe(true);
    expect(isArt('A', 'en')).toBe(true);
    expect(isArt('der', 'de')).toBe(true);
    expect(isArt('the', 'de')).toBe(false);
  });
  // ONE vocabulary: numberings and qualifiers alike widen a term and may alike be
  // dropped on a later reference to the same sign (logic/cumulative.ts). The two
  // halves are spelled out here so a word added to EN_ORD/DE_ORD has to be added
  // to CLAUDE.md's table as well — the list is what a drafter has to be able to
  // look up when the tool silently reads two words as one term.
  const EN_NUMBERINGS = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
    'eleventh',
    'twelfth',
  ];
  const EN_QUALIFIERS = [
    'further',
    'other',
    'another',
    'next',
    'upper',
    'lower',
    'inner',
    'outer',
    'front',
    'rear',
    'left',
    'right',
    'top',
    'bottom',
    'primary',
    'secondary',
    'main',
    'auxiliary',
    'additional',
  ];
  // Stems, because the forms are generated: every stem below × the five endings
  // -e -en -er -es -em, which is what German actually declines through.
  const DE_NUMBERING_STEMS = [
    'erst',
    'zweit',
    'dritt',
    'viert',
    'fünft',
    'sechst',
    'siebt',
    'siebent',
    'acht',
    'neunt',
    'zehnt',
    'elft',
    'zwölft',
  ];
  const DE_QUALIFIER_STEMS = [
    'weiter',
    'zusätzlich',
    'primär',
    'sekundär',
    'ober',
    'unter',
    'inner',
    'äußer',
    'vorder',
    'hinter',
    'link',
    'recht',
    'ander',
  ];
  const ENDINGS = ['e', 'en', 'er', 'es', 'em'];

  it('isOrd accepts numberings and qualifiers alike, in both languages', () => {
    for (const w of [...EN_NUMBERINGS, ...EN_QUALIFIERS]) expect(isOrd(w, 'en')).toBe(true);
    for (const st of DE_QUALIFIER_STEMS) expect(isOrd(st + 'e', 'de')).toBe(true);
    expect(isOrd('Zweite', 'de')).toBe(true); // matched on the raw word, case-folded
    expect(isOrd('banana', 'en')).toBe(false);
    expect(isOrd('first', 'de')).toBe(false); // language-specific
  });

  // Spelled out rather than generated: this is the case the generation exists
  // for, and asserting it against the same cross-product the source builds would
  // assert nothing. "obere"/"oberen" were once the only two forms present.
  it('carries every inflection of a German qualifier, not just -e and -en', () => {
    for (const w of ['obere', 'oberen', 'oberer', 'oberes', 'oberem'])
      expect(isOrd(w, 'de')).toBe(true);
    for (const w of ['linke', 'linken', 'linker', 'linkes', 'linkem'])
      expect(isOrd(w, 'de')).toBe(true);
    for (const w of ['andere', 'anderen', 'anderer', 'anderes', 'anderem'])
      expect(isOrd(w, 'de')).toBe(true);
    for (const w of ['zusätzliche', 'zusätzlichen', 'zusätzlicher', 'zusätzliches', 'zusätzlichem'])
      expect(isOrd(w, 'de')).toBe(true);
  });

  it('carries every German ordinal inflection up to twelfth', () => {
    // A draft uses all of them ("der dritte", "des dritten", "einem dritten").
    for (const st of ['erst', 'zweit', 'dritt', 'viert', 'fünft', 'acht', 'zwölft'])
      for (const e of ENDINGS) expect(isOrd(st + e, 'de')).toBe(true);
    expect(isOrd('acht', 'de')).toBe(false); // the cardinal is not an ordinal
  });

  it('holds exactly the vocabulary CLAUDE.md tabulates', () => {
    // Pinned in both directions: an addition fails here until the table says
    // which half it joins, and a deletion fails too.
    const de = [...DE_NUMBERING_STEMS, ...DE_QUALIFIER_STEMS].flatMap((st) =>
      ENDINGS.map((e) => st + e)
    );
    expect([...EN_ORD].sort()).toEqual([...EN_NUMBERINGS, ...EN_QUALIFIERS].sort());
    expect([...DE_ORD].sort()).toEqual(de.sort());
  });

  it('records which modifiers are also excluded words', () => {
    // Being in both is legal and meaningful: EXCL bars a word from being the
    // BASE NOUN, while the modifier sets let it QUALIFY one. "a further 200
    // rivets" registers no term; "a further shaft 20" is "further shaft".
    // collectTermToks implements that, and extract.test.ts pins the behaviour —
    // this is just the inventory, so adding such a word is a conscious act.
    expect([...EN_ORD].filter((w) => EXCL.has(w))).toEqual(['further']);
    expect([...DE_ORD].filter((w) => EXCL.has(w))).toEqual([]);
  });

  it('artType classifies definite vs indefinite', () => {
    expect(artType('the')).toBe('def');
    expect(artType('a')).toBe('indef');
    expect(artType('eine')).toBe('indef');
    expect(artType('der')).toBe('def');
  });
});

describe('disKey', () => {
  // The declared single source of truth for dismissal keys. Every test that
  // exercises dismissals elsewhere hard-codes the literal strings ('s:12'), so
  // without these the scheme could change and the suite would stay green while
  // every saved dismissal in a user's localStorage silently stopped matching.
  it('namespaces each category so keys cannot collide across types', () => {
    const keys = [
      disKey.sign('12'),
      disKey.art('12'),
      disKey.bare('12'),
      disKey.num('12'),
      disKey.dep('12'),
    ];
    expect(new Set(keys).size).toBe(5);
  });

  it('produces the prefixes the persisted format uses', () => {
    expect(disKey.sign('12')).toBe('s:12');
    expect(disKey.art('hous')).toBe('a:hous');
    expect(disKey.bare('hous')).toBe('b:hous');
    expect(disKey.num('3#1')).toBe('n:3#1');
    expect(disKey.dep('3>9#1')).toBe('d:3>9#1');
  });

  it('is stable for the same id', () => {
    expect(disKey.sign('12a')).toBe(disKey.sign('12a'));
  });

  it('keeps multi-word term stems distinct', () => {
    expect(disKey.art('first bear')).not.toBe(disKey.art('second bear'));
  });
});
