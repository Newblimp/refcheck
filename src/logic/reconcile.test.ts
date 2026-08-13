import { describe, it, expect } from 'vitest';
import { must } from '../test/helpers.ts';
import { parseRefList } from './refListParse.ts';
import { reconcileRefList } from './reconcile.ts';
import { extractData } from './extract.ts';

describe('parseRefList', () => {
  it('parses the plain "10 housing" form', () => {
    const { entries } = parseRefList('10 housing\n12 cover');
    expect(entries).toEqual([
      { sign: '10', term: 'housing', line: 0 },
      { sign: '12', term: 'cover', line: 1 },
    ]);
  });

  it('accepts the separators real lists actually use', () => {
    const { entries } = parseRefList(
      ['10 housing', '12\tcover', '14 - shaft', '16 – seal', '18: flange', '20) bearing'].join('\n')
    );
    expect(entries.map((e) => e.term)).toEqual([
      'housing',
      'cover',
      'shaft',
      'seal',
      'flange',
      'bearing',
    ]);
  });

  it('keeps multi-word terms intact', () => {
    const { entries } = parseRefList('10 first bearing surface');
    expect(entries[0].term).toBe('first bearing surface');
  });

  it('handles letter-suffixed and primed signs', () => {
    const { entries } = parseRefList("12a cover\n10' housing");
    expect(entries.map((e) => e.sign)).toEqual(['12a', "10'"]);
  });

  it('skips lines that do not start with a sign', () => {
    const { entries } = parseRefList('List of reference signs\n\n10 housing\nsee also below');
    expect(entries).toHaveLength(1);
    expect(entries[0].sign).toBe('10');
  });

  it('skips a bare sign with no term', () => {
    expect(parseRefList('10\n12 cover').entries).toHaveLength(1);
  });

  it('reports a sign listed twice with different terms', () => {
    const { duplicates } = parseRefList('10 housing\n12 cover\n10 casing');
    expect(duplicates).toEqual([{ sign: '10', terms: ['housing', 'casing'] }]);
  });

  it('does not report a harmless exact duplicate', () => {
    expect(parseRefList('10 housing\n10 housing').duplicates).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(parseRefList('').entries).toEqual([]);
    expect(parseRefList(null).entries).toEqual([]);
  });
});

describe('reconcileRefList', () => {
  const TEXT =
    'A housing 10 is provided. The housing 10 holds a cover 12. ' +
    'The cover 12 seals a shaft 14. The shaft 14 rotates.';
  const res = () => extractData(TEXT, 'en');

  it('returns null when there is nothing to compare', () => {
    expect(reconcileRefList('', res(), 'en')).toBe(null);
    expect(reconcileRefList('10 housing', null, 'en')).toBe(null);
    expect(reconcileRefList('no signs here', res(), 'en')).toBe(null);
  });

  it('reports a clean list as fully matched', () => {
    const r = must(reconcileRefList('10 housing\n12 cover\n14 shaft', res(), 'en'));
    expect(r.hasAny).toBe(false);
    expect(r.matched).toBe(3);
    expect(r.listed).toBe(3);
  });

  it('flags a sign listed but never used — a leftover from a deleted passage', () => {
    const r = must(reconcileRefList('10 housing\n12 cover\n14 shaft\n99 flywheel', res(), 'en'));
    expect(r.listedNotUsed).toEqual([{ sign: '99', term: 'flywheel' }]);
  });

  it('flags a sign used but missing from the list', () => {
    const r = must(reconcileRefList('10 housing\n12 cover', res(), 'en'));
    expect(r.usedNotListed.map((u) => u.sign)).toEqual(['14']);
    expect(r.usedNotListed[0].term).toBe('shaft');
  });

  it('flags a term mismatch — the case that actually costs money', () => {
    const r = must(reconcileRefList('10 casing\n12 cover\n14 shaft', res(), 'en'));
    expect(r.termMismatch).toEqual([{ sign: '10', listTerm: 'casing', textTerm: 'housing' }]);
  });

  it('does not flag a plural/singular difference as a mismatch', () => {
    // The list says "housings", the text says "housing" — same term.
    const r = must(reconcileRefList('10 housings\n12 cover\n14 shaft', res(), 'en'));
    expect(r.termMismatch).toEqual([]);
    expect(r.matched).toBe(3);
  });

  it('does not flag a term the text also refers to without its numbering', () => {
    // The drafter lists "erste Welle" and writes "die Wellen 10, 20 und 30"
    // more often than the numbered form. The list is right, and reporting it as
    // a mismatch would push the drafter into changing a correct entry.
    const de = extractData(
      'Eine erste Welle 10 und eine zweite Welle 20 sind vorgesehen.\n' +
        'Die Wellen 10, 20 sind koaxial.\nDie Wellen 10, 20 rotieren.',
      'de'
    );
    const r = must(reconcileRefList('10 erste Welle\n20 zweite Welle', de, 'de'));
    expect(r.termMismatch).toEqual([]);
    expect(r.matched).toBe(2);
    expect(r.hasAny).toBe(false);
  });

  it('ignores case differences', () => {
    const r = must(reconcileRefList('10 Housing\n12 COVER\n14 shaft', res(), 'en'));
    expect(r.termMismatch).toEqual([]);
  });

  it('sorts findings numerically by sign', () => {
    const r = must(reconcileRefList('100 a\n20 b\n3 c', res(), 'en'));
    expect(r.listedNotUsed.map((x) => x.sign)).toEqual(['3', '20', '100']);
  });

  it('uses the first listing when a sign is duplicated, and reports the duplicate', () => {
    const r = must(reconcileRefList('10 housing\n10 casing\n12 cover\n14 shaft', res(), 'en'));
    expect(r.duplicates).toHaveLength(1);
    expect(r.termMismatch).toEqual([]); // first listing matches the text
    expect(r.hasAny).toBe(true);
  });

  it('works in German', () => {
    const de = extractData(
      'Ein Gehäuse 10 ist vorgesehen. Das Gehäuse 10 hält einen Deckel 12.',
      'de'
    );
    const r = must(reconcileRefList('10 Gehäuse\n12 Deckel', de, 'de'));
    expect(r.termMismatch).toEqual([]);
    expect(r.hasAny).toBe(false);
  });

  it('tolerates a heading line above the list', () => {
    const r = must(
      reconcileRefList('Bezugszeichenliste\n\n10 housing\n12 cover\n14 shaft', res(), 'en')
    );
    expect(r.listed).toBe(3);
    expect(r.hasAny).toBe(false);
  });
});
