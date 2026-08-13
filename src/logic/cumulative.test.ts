import { describe, it, expect } from 'vitest';
import { canonicalCumulativeTerms, cumKey } from './cumulative.ts';
import type { TermOccurrence } from './cumulative.ts';
import type { Lang } from './constants.ts';

// The rule in isolation: which shortened terms are back-references to a term
// introduced with a distinguishing modifier, and which are left alone. Everything here is
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
  it('folds a shortened term into the widened one under the same sign', () => {
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

  it('folds a multi-word base, dropping only the modifier', () => {
    const m = fold([
      occ('20', 'first bearing surface', 'first bear surfac'),
      occ('20', 'bearing surfaces', 'bear surfac'),
    ]);
    expect(m.get(cumKey('20', 'bear surfac'))).toBe('first bear surfac');
  });

  it('folds a dropped qualifier exactly as it folds a dropped numbering', () => {
    // One vocabulary: "das obere Gehäuse 12" later written "das Gehäuse 12" is
    // the same construct as "erste Welle 10" → "die Welle 10". The sign settles
    // the reference in both.
    const en = fold([occ('12', 'upper housing', 'upper hous'), occ('12', 'housing', 'hous')]);
    expect(en.get(cumKey('12', 'hous'))).toBe('upper hous');
    const de = fold(
      [occ('12', 'obere gehäuse', 'ober gehaus'), occ('12', 'gehäuse', 'gehaus')],
      'de'
    );
    expect(de.get(cumKey('12', 'gehaus'))).toBe('ober gehaus');
  });

  it('folds each sign against its own modifier', () => {
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
  it('leaves a sign that never dropped its modifier alone', () => {
    expect(fold([occ('10', 'first shaft', 'first shaft')]).size).toBe(0);
  });

  it('never folds across signs', () => {
    // Sign 30 was never introduced as a modified shaft, so its bare "shaft" is
    // its own term — and stays reportable.
    const m = fold([occ('10', 'first shaft', 'first shaft'), occ('30', 'shaft', 'shaft')]);
    expect(m.size).toBe(0);
  });

  it('leaves a first word that is not a modifier alone', () => {
    // "control unit" is the drafter's own declared vocabulary (it can only have
    // become a two-word term through the reference list or by hand), so "the
    // unit 30" is a departure from it, not a shorthand for it.
    expect(fold([occ('30', 'control unit', 'control unit'), occ('30', 'unit', 'unit')]).size).toBe(
      0
    );
  });

  it('leaves a CHANGED modifier alone — only a dropped one is forgiven', () => {
    // "das obere Gehäuse 12" and "das untere Gehäuse 12" cannot both be sign 12.
    // Two widened forms means no single term to fold into, so the bare
    // "Gehäuse 12" stays visible alongside them.
    const m = fold(
      [
        occ('12', 'obere gehäuse', 'ober gehaus'),
        occ('12', 'untere gehäuse', 'unter gehaus'),
        occ('12', 'gehäuse', 'gehaus'),
      ],
      'de'
    );
    expect(m.size).toBe(0);
  });

  it('leaves an ambiguous sign alone (two modifiers, one sign)', () => {
    // "a first shaft 10" and "a second shaft 10" is itself the inconsistency the
    // tool reports; folding would pick one of them and hide it.
    const m = fold([
      occ('10', 'first shaft', 'first shaft'),
      occ('10', 'second shaft', 'second shaft'),
      occ('10', 'shaft', 'shaft'),
    ]);
    expect(m.size).toBe(0);
  });

  it('leaves a term that lost more than its modifier alone', () => {
    // "first bearing surface" → "surface" drops the base noun too, so the two
    // are not the same term with the modifier taken off.
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

  it('does not read a modifier in the wrong language', () => {
    expect(
      fold([occ('10', 'erste welle', 'erst well'), occ('10', 'welle', 'well')], 'en').size
    ).toBe(0);
  });

  it('ignores a term whose raw form and stem disagree in length', () => {
    // Defensive: the two are built from the same tokens, so this cannot happen —
    // and if it ever does, the modifier cannot be located reliably.
    expect(fold([occ('10', 'first shaft', 'shaft'), occ('10', 'shaft', 'shaft')]).size).toBe(0);
  });
});
