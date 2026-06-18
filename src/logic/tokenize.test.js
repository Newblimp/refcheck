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
});
