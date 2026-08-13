import { describe, it, expect } from 'vitest';
import { canonicalCumulativeTerms, cumKey } from './cumulative.ts';
import type { TermOccurrence } from './cumulative.ts';
import type { Lang } from './constants.ts';

// The rule in isolation: which shortened terms are back-references to a term
// introduced with a numbering, and which are left alone. Everything here is
// about the SECOND half of that sentence — a rule that suppresses errors is only
// as good as the cases it refuses to touch.

const occ = (sign: string, term: string, termStem: string): TermOccurrence => ({
  sign,
  term,
  termStem,
});

const fold = (occs: TermOccurrence[], lang: Lang = 'en') => canonicalCumulativeTerms(occs, lang);

describe('cumKey', () => {
  it('cannot collide, whatever the two halves contain', () => {
    // The separator is not in the alphabet either half is built from, so no
    // pairing of a sign with a term stem can produce another pairing's key.
    expect(cumKey('10', 'first shaft')).not.toBe(cumKey('10 first', 'shaft'));
    expect(cumKey("10'", 'shaft')).not.toBe(cumKey('10', "' shaft"));
    expect(cumKey('10', 'shaft')).toBe(cumKey('10', 'shaft'));
  });
});

describe('canonicalCumulativeTerms — what it folds', () => {
  it('folds a shortened term into the numbered one under the same sign', () => {
    const m = fold([occ('10', 'first shaft', 'first shaft'), occ('10', 'shafts', 'shaft')]);
    expect(m.get(cumKey('10', 'shaft'))).toBe('first shaft');
    expect(m.size).toBe(1);
  });

  it('does not care which came first in the document', () => {
    const m = fold([occ('10', 'shafts', 'shaft'), occ('10', 'first shaft', 'first shaft')]);
    expect(m.get(cumKey('10', 'shaft'))).toBe('first shaft');
  });

  it('folds German numberings in every inflection', () => {
    for (const num of ['erste', 'ersten', 'erster', 'erstes', 'erstem']) {
      const m = fold([occ('10', `${num} welle`, 'erst well'), occ('10', 'wellen', 'well')], 'de');
      expect(m.get(cumKey('10', 'well'))).toBe('erst well');
    }
  });

  it('folds a multi-word base, dropping only the numbering', () => {
    const m = fold([
      occ('20', 'first bearing surface', 'first bear surfac'),
      occ('20', 'bearing surfaces', 'bear surfac'),
    ]);
    expect(m.get(cumKey('20', 'bear surfac'))).toBe('first bear surfac');
  });

  it('folds each sign against its own numbering', () => {
    const m = fold([
      occ('10', 'first shaft', 'first shaft'),
      occ('20', 'second shaft', 'second shaft'),
      occ('10', 'shafts', 'shaft'),
      occ('20', 'shafts', 'shaft'),
    ]);
    expect(m.get(cumKey('10', 'shaft'))).toBe('first shaft');
    expect(m.get(cumKey('20', 'shaft'))).toBe('second shaft');
  });
});

describe('canonicalCumulativeTerms — what it refuses to fold', () => {
  it('leaves a sign that never dropped its numbering alone', () => {
    expect(fold([occ('10', 'first shaft', 'first shaft')]).size).toBe(0);
  });

  it('never folds across signs', () => {
    // Sign 30 was never introduced as a numbered shaft, so its bare "shaft" is
    // its own term — and stays reportable.
    const m = fold([occ('10', 'first shaft', 'first shaft'), occ('30', 'shaft', 'shaft')]);
    expect(m.size).toBe(0);
  });

  it('leaves a qualifier that is not a numbering alone', () => {
    // "the upper housing 12" written later as "the housing 12" may well be the
    // drafter losing the qualifier — that is the error, not a shorthand.
    expect(
      fold([occ('12', 'upper housing', 'upper hous'), occ('12', 'housing', 'hous')]).size
    ).toBe(0);
    expect(
      fold([occ('12', 'weitere welle', 'weiter well'), occ('12', 'welle', 'well')], 'de').size
    ).toBe(0);
  });

  it('leaves an ambiguous sign alone (two numberings, one sign)', () => {
    // "a first shaft 10" and "a second shaft 10" is itself the inconsistency the
    // tool reports; folding would pick one of them and hide it.
    const m = fold([
      occ('10', 'first shaft', 'first shaft'),
      occ('10', 'second shaft', 'second shaft'),
      occ('10', 'shaft', 'shaft'),
    ]);
    expect(m.size).toBe(0);
  });

  it('leaves a term that lost more than its numbering alone', () => {
    // "first bearing surface" → "surface" drops the base noun too, so the two
    // are not the same term with the numbering taken off.
    const m = fold([
      occ('20', 'first bearing surface', 'first bear surfac'),
      occ('20', 'surface', 'surfac'),
    ]);
    expect(m.size).toBe(0);
  });

  it('leaves a different noun alone', () => {
    expect(fold([occ('10', 'first shaft', 'first shaft'), occ('10', 'housing', 'hous')]).size).toBe(
      0
    );
  });

  it('does not read a numbering in the wrong language', () => {
    expect(
      fold([occ('10', 'erste welle', 'erst well'), occ('10', 'welle', 'well')], 'en').size
    ).toBe(0);
  });

  it('ignores a term whose raw form and stem disagree in length', () => {
    // Defensive: the two are built from the same tokens, so this cannot happen —
    // and if it ever does, the numbering cannot be located reliably.
    expect(fold([occ('10', 'first shaft', 'shaft'), occ('10', 'shaft', 'shaft')]).size).toBe(0);
  });
});
