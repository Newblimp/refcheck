import { describe, it, expect } from 'vitest';
import { likelySign, isClaimNumber, isArt, isOrd, artType } from './constants.js';
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
