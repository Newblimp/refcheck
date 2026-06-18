import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize.js';

describe('tokenize', () => {
  it('splits words and numbers with character spans', () => {
    const toks = tokenize('housing 12');
    expect(toks).toEqual([
      { word: 'housing', start: 0, end: 7 },
      { word: '12', start: 8, end: 10 },
    ]);
  });

  it('keeps a trailing-letter sign as one token (e.g. 12a)', () => {
    const toks = tokenize('cover 12a here');
    expect(toks.map(t => t.word)).toEqual(['cover', '12a', 'here']);
  });

  it('reports spans that exclude surrounding parentheses', () => {
    const toks = tokenize('device (10)');
    const sign = toks.find(t => t.word === '10');
    expect(sign).toEqual({ word: '10', start: 8, end: 10 });
  });

  it('keeps German letters and hyphens within a word', () => {
    expect(tokenize('Gehäuse-Deckel').map(t => t.word)).toEqual(['Gehäuse-Deckel']);
  });

  it('emits no token for a digit run longer than a valid sign (>5 digits)', () => {
    // The number branch only matches \d{1,5}; a 6-digit run is bounded by digits
    // on every side, so no token can terminate inside it.
    expect(tokenize('123456')).toEqual([]);
  });

  it('emits no token when a word and number are glued together', () => {
    // Known limitation: the lookbehind/lookahead require a non-alphanumeric
    // boundary, so "housing12" yields neither "housing" nor "12". Signs must be
    // whitespace- or punctuation-separated from their term to be detected.
    expect(tokenize('housing12')).toEqual([]);
    expect(tokenize('12housing')).toEqual([]);
  });

  it('does not merge a number across a decimal point', () => {
    // "3.5" — the '.' is not a word/number character, so two tokens appear.
    expect(tokenize('3.5').map(t => t.word)).toEqual(['3', '5']);
  });

  it('returns an empty array for text with no word/number characters', () => {
    expect(tokenize('—  ()  ,')).toEqual([]);
  });

  it('records correct spans for multiple tokens on a line', () => {
    const toks = tokenize('a cover 14.');
    expect(toks).toEqual([
      { word: 'a', start: 0, end: 1 },
      { word: 'cover', start: 2, end: 7 },
      { word: '14', start: 8, end: 10 },
    ]);
  });
});
