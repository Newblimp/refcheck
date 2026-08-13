import { describe, it, expect } from 'vitest';
import { must } from '../test/helpers.ts';
import { extractData } from './extract.ts';
import { buildRefList, toPlainText } from './reflist.ts';

const desc = (txt: string) => extractData(txt, 'en');

describe('buildRefList', () => {
  it('builds a numerically sorted sign → term table with counts', () => {
    const r = desc(
      'The device 10 comprises a housing 12 and a cover 14. ' +
        'The housing 12 is metal. The cover 14 is plastic.'
    );
    const rows = buildRefList(r.signData, r.termData);
    expect(rows.map((x) => x.sign)).toEqual(['10', '12', '14']);
    expect(rows.find((x) => x.sign === '12')).toMatchObject({ term: 'housing', count: 2 });
    expect(must(rows.find((x) => x.sign === '10')).count).toBe(1);
  });

  it('picks the dominant (most frequent) term when a sign is inconsistent', () => {
    const r = desc('The housing 12 is here. The housing 12 again. The casing 12 once.');
    const row = must(buildRefList(r.signData, r.termData).find((x) => x.sign === '12'));
    expect(row.term).toBe('housing'); // 2× housing beats 1× casing
  });

  it('prefers the wider (more qualified) term on a count tie', () => {
    const r = extractData(
      'Planetenradsatz 10\nzweiter Planetenradsatz 20\nerster Planetenradsatz 10',
      'de'
    );
    const row = must(buildRefList(r.signData, r.termData).find((x) => x.sign === '10'));
    expect(row.term).toBe('erster planetenradsatz'); // 1× each, but the ordinal-qualified form wins
    expect(row.count).toBe(2);
  });

  it('sorts primed signs after their bare number', () => {
    const r = desc("The arm 10 and the arm 10' differ.");
    expect(buildRefList(r.signData, r.termData).map((x) => x.sign)).toEqual(['10', "10'"]);
  });

  it('returns an empty array when there are no signs', () => {
    expect(buildRefList({}, {})).toEqual([]);
  });
});

describe('toPlainText', () => {
  it('renders tab-separated sign/term lines', () => {
    const rows = [
      { sign: '10', term: 'device', count: 1 },
      { sign: '12', term: 'housing', count: 2 },
    ];
    expect(toPlainText(rows)).toBe('10\tdevice\n12\thousing');
  });
});
