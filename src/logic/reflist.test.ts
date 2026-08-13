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
    // "upper" is a qualifier, not a numbering, so the two spellings stay two
    // terms and the tie-break is what decides the row.
    const r = desc('The bearing 20 is here. The upper bearing 20 is shown.');
    const row = must(buildRefList(r.signData, r.termData).find((x) => x.sign === '20'));
    expect(row.term).toBe('upper bearing'); // 1× each, but the wider form wins
    expect(row.count).toBe(2);
  });

  it('lists the numbered form of a term the text also refers to without it', () => {
    // A numbered term dropped on a cumulative back-reference stays the sign's
    // term (logic/cumulative.ts), so the list names it that way — no tie-break
    // involved, and the short form winning on count is exactly what must not
    // happen: a reference list saying "10 Wellen" is wrong for three shafts.
    const r = extractData(
      'Eine erste Welle 10, eine zweite Welle 20 und eine dritte Welle 30 sind vorgesehen.\n' +
        'Die Wellen 10, 20 und 30 sind koaxial.\n' +
        'Die Wellen 10, 20 und 30 rotieren.\n' +
        'Die Wellen 10, 20 und 30 sind gelagert.',
      'de'
    );
    const row = must(buildRefList(r.signData, r.termData).find((x) => x.sign === '10'));
    expect(row.term).toBe('erste welle'); // 3× "Wellen" against 1× "erste Welle"
    expect(row.count).toBe(4); // every occurrence still counts
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
