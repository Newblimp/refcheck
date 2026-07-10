import { describe, it, expect } from 'vitest';
import { likelySign, isClaimNumber, isArt, isOrd, artType, isSignToken, compareSigns, romanToInt, signVal } from './constants.js';
import { tokenize } from './tokenize.js';

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
  const tokFor = (text, word, occ = 0) => {
    const matches = tokenize(text).filter(t => t.word === word);
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
    expect(isSignToken("10'")).toBe(true);   // ASCII apostrophe
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
    expect(isSignToken('ii')).toBe(false);   // must be uppercase
    expect(isSignToken('I.')).toBe(false);   // substep needs an Arabic numeral
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
  it('orders numerically, then by suffix (10 < 10\' < 10a < 12)', () => {
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
  it('isOrd recognises ordinals/adjectives', () => {
    expect(isOrd('first', 'en')).toBe(true);
    expect(isOrd('zweite', 'de')).toBe(true);
    expect(isOrd('banana', 'en')).toBe(false);
  });
  it('artType classifies definite vs indefinite', () => {
    expect(artType('the')).toBe('def');
    expect(artType('a')).toBe('indef');
    expect(artType('eine')).toBe('indef');
    expect(artType('der')).toBe('def');
  });
});
