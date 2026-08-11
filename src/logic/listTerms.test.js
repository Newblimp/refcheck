import { describe, it, expect } from 'vitest';
import { listTermIndex, listExtra, appliedListTerms, MAX_LIST_TERM_WORDS } from './listTerms.ts';
import { stem } from './stem.ts';
import { tokenize } from './tokenize.ts';
import { extractData } from './extract.ts';

// Term tokens as extract.js collects them: the words in front of a sign, base
// noun last.
const toks = (phrase) => tokenize(phrase);
const extraFor = (idx, phrase, lang = 'en') => {
  const tt = toks(phrase);
  return listExtra(idx, tt, stem(tt[tt.length - 1].word, lang), lang);
};

describe('listTermIndex', () => {
  it('indexes multi-word entries and skips single-word ones', () => {
    const idx = listTermIndex('10 device\n30 control unit\n20 first bearing surface', 'en');
    expect(idx.size).toBe(2);
    expect(idx.all.map((r) => r.term)).toEqual(['control unit', 'first bearing surface']);
    expect(idx.byBase.get(stem('unit', 'en')).get(stem('control', 'en'))).toHaveLength(1);
    expect(idx.byBase.has(stem('device', 'en'))).toBe(false);
  });

  it('returns an empty index for empty, blank or term-less input', () => {
    for (const t of ['', '   ', '10\n12\n', 'A list of reference signs']) {
      const idx = listTermIndex(t, 'en');
      expect(idx.size).toBe(0);
      expect(extraFor(idx, 'the control unit')).toBe(0);
    }
  });

  it('drops punctuation and a stray sign inside the term', () => {
    const idx = listTermIndex('30 - control unit,\n40: drive unit 41', 'en');
    expect(idx.all.map((r) => r.term)).toEqual(['control unit', 'drive unit']);
  });

  it('collapses entries that stem to the same phrase', () => {
    const idx = listTermIndex('30 control unit\n31 Control Units', 'en');
    expect(idx.size).toBe(1);
  });

  it('ignores a phrase longer than the backward walk could ever match', () => {
    const long = Array.from({ length: MAX_LIST_TERM_WORDS + 1 }, (_, i) => `word${'x'.repeat(i)}`);
    const idx = listTermIndex(`10 ${long.join(' ')}`, 'en');
    expect(idx.size).toBe(0);
  });

  it('gives equal signatures to lists that differ only in layout', () => {
    const a = listTermIndex('30 control unit\n40 drive unit', 'en');
    const b = listTermIndex('40  –  drive units\n30\tcontrol unit\n\n', 'en');
    expect(b.sig).toBe(a.sig);
    // …and different ones once a term really changes.
    expect(listTermIndex('30 control panel\n40 drive unit', 'en').sig).not.toBe(a.sig);
  });

  it('stems in the list language', () => {
    const de = listTermIndex('20 erstes Lager', 'de');
    expect(de.size).toBe(1);
    expect(extraFor(de, 'das erste Lager', 'de')).toBe(1);
  });
});

describe('listExtra', () => {
  const idx = listTermIndex('30 control unit\n20 first bearing surface\n22 bearing surface', 'en');

  it('extends a term the list spells out', () => {
    expect(extraFor(idx, 'the control unit')).toBe(1);
  });

  it('leaves a different modifier alone', () => {
    // "drive unit" is not the listed phrase, so the base noun stands on its own
    // rather than every "unit" in the document being widened.
    expect(extraFor(idx, 'a drive unit')).toBe(0);
  });

  it('prefers the longest listed phrase that matches', () => {
    expect(extraFor(idx, 'the first bearing surface')).toBe(2);
    expect(extraFor(idx, 'the outer bearing surface')).toBe(1);
  });

  it('does not match a phrase longer than the words available', () => {
    expect(extraFor(idx, 'surface')).toBe(0);
  });

  it('matches across inflections, since it compares stems', () => {
    expect(extraFor(idx, 'the control units')).toBe(1);
  });

  it('says nothing about a base noun the list does not mention', () => {
    expect(extraFor(idx, 'the aluminium housing')).toBe(0);
  });
});

describe('appliedListTerms', () => {
  const list = '30 control unit\n40 drive unit\n50 cooling fan';
  const idx = listTermIndex(list, 'en');
  const text = 'The control unit 30 drives a drive unit 40.';

  it('reports the listed terms the text actually uses, in list order', () => {
    const res = extractData(text, 'en', {}, true, false, idx);
    expect(appliedListTerms(idx, res.termData)).toEqual(['control unit', 'drive unit']);
  });

  it('drops a term the drafter has reduced by hand', () => {
    const res = extractData(text, 'en', { [stem('unit', 'en')]: 0 }, true, false, idx);
    expect(appliedListTerms(idx, res.termData)).toEqual([]);
  });

  it('is empty without an index or a result', () => {
    expect(appliedListTerms(idx, null)).toEqual([]);
    expect(appliedListTerms(listTermIndex('', 'en'), { 'control unit': {} })).toEqual([]);
  });
});
