// The verifier is the last thing standing between a bad write and a filed
// document, so it has to be right in both directions: it must not cry wolf over
// the differences the export makes deliberately, and it must catch a real one.
import { describe, it, expect } from 'vitest';
import { verifyExport } from './verify.ts';
import { writeDocx } from './write.ts';
import { readDocx } from './read.ts';
import { splitPatentDoc } from '../docSplit.ts';
import { para, makeDocx, EN_BODY, DE_BODY } from './fixture.ts';

const load = (body: string) => {
  const doc = readDocx(makeDocx(body));
  return { doc, split: splitPatentDoc(doc) };
};

/** Export `buffers` from `body` and verify the result. */
const roundTrip = (body: string, buffers: { description: string; claims: string }) => {
  const { doc, split } = load(body);
  const bytes = writeDocx(doc, [
    { paras: split.descParas, text: buffers.description },
    { paras: split.claimsParas, text: buffers.claims, claims: true },
  ]);
  return verifyExport(bytes, buffers);
};

describe('verifyExport — accepts what the export does on purpose', () => {
  it('an unchanged document', () => {
    const { split } = load(EN_BODY);
    expect(roundTrip(EN_BODY, { description: split.description, claims: split.claims })).toEqual({
      ok: true,
      diffs: [],
    });
  });

  it('an ordinary edit in both buffers', () => {
    const { split } = load(EN_BODY);
    const r = roundTrip(EN_BODY, {
      description: split.description.replace('housing 12 is made', 'housing 14 is made'),
      claims: split.claims.replace('housing (12)', 'housing (14)'),
    });
    expect(r).toEqual({ ok: true, diffs: [] });
  });

  it('claim numbers that Word will renumber (a Word-list source)', () => {
    // The buffer numbers the second claim "5"; Word will render "2". That is
    // the claim-numbering error the tool exists to show, not an export fault.
    const { split } = load(DE_BODY);
    const r = roundTrip(DE_BODY, {
      description: split.description,
      claims: '1. Vorrichtung (10) mit einem Gehäuse (12).\n5. Vorrichtung (10) nach Anspruch 1.',
    });
    expect(r.ok).toBe(true);
  });

  it('blank lines at the edges, which the importer trims', () => {
    const { split } = load(EN_BODY);
    const r = roundTrip(EN_BODY, {
      description: `\n\n${split.description}\n\n`,
      claims: split.claims,
    });
    expect(r.ok).toBe(true);
  });

  it('a character XML cannot hold, which the writer drops on purpose', () => {
    const { split } = load(EN_BODY);
    const r = roundTrip(EN_BODY, {
      description: split.description.replace('aluminium', 'alu\x0Cminium'),
      claims: split.claims,
    });
    expect(r.ok).toBe(true);
  });

  it('a typed claim number, which is text and must NOT be normalized away', () => {
    // EN_BODY types its claim numbers, so a wrong one is a genuine difference
    // if the file does not carry it — the tolerance is list-sources only.
    const { split } = load(EN_BODY);
    const r = roundTrip(EN_BODY, {
      description: split.description,
      claims: '1. A device (10) comprising a housing (12).\n5. A device (10) according to claim 1.',
    });
    expect(r.ok).toBe(true); // it IS in the file, verbatim
  });
});

describe('verifyExport — catches what it should', () => {
  it('claims the source document has nowhere to put', () => {
    const body = [
      para('DETAILED DESCRIPTION', { style: 'Heading1' }),
      para('The device 10 comprises a housing 12.'),
    ].join('');
    const r = roundTrip(body, {
      description: 'The device 10 comprises a housing 12.',
      claims: '1. A device (10).',
    });
    expect(r.ok).toBe(false);
    expect(r.diffs).toEqual([
      { section: 'claims', line: 1, expected: '1. A device (10).', actual: '' },
    ]);
  });

  it('reports the first differing line, not the last', () => {
    const { split } = load(EN_BODY);
    const bytes = writeDocx(load(EN_BODY).doc, [
      { paras: split.descParas, text: split.description },
      { paras: split.claimsParas, text: split.claims, claims: true },
    ]);
    // Verify against buffers the file was never written from.
    const r = verifyExport(bytes, {
      description: 'The device 10 comprises a housing 12.\nSomething else entirely.',
      claims: split.claims,
    });
    expect(r.ok).toBe(false);
    expect(r.diffs[0]).toMatchObject({ section: 'description', line: 2 });
    expect(r.diffs[0].expected).toBe('Something else entirely.');
  });

  it('reports an unreadable file rather than passing it as fine', () => {
    const r = verifyExport(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), {
      description: '',
      claims: '',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('notZip');
  });
});
