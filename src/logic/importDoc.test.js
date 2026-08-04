import { describe, it, expect } from 'vitest';
import { fileKind, importPatentDoc, exportPatentDoc } from './importDoc.js';
import { readDocx } from './docx/read.js';
import { splitPatentDoc } from './docSplit.js';
import { documentXmlOf } from './docx/write.js';
import { makeDocx, DE_BODY, EN_BODY } from './docx/fixture.js';

describe('fileKind', () => {
  it('accepts .docx and .docm, in any case', () => {
    expect(fileKind('application.docx')).toBe('ok');
    expect(fileKind('APPLICATION.DOCX')).toBe('ok');
    expect(fileKind('macro.docm')).toBe('ok');
  });
  it('singles out legacy .doc so the user gets a useful message', () => {
    expect(fileKind('old draft.doc')).toBe('legacyDoc');
  });
  it('rejects everything else', () => {
    expect(fileKind('spec.pdf')).toBe('unsupported');
    expect(fileKind('notes.txt')).toBe('unsupported');
    expect(fileKind('')).toBe('unsupported');
    expect(fileKind(undefined)).toBe('unsupported');
  });
});

describe('importPatentDoc', () => {
  it('returns buffers, language and provenance for a German application', () => {
    const r = importPatentDoc(makeDocx(DE_BODY));
    expect(r.lang).toBe('de');
    expect(r.langFrom).toBe('headings');
    expect(r.split.description).toContain('Die Vorrichtung 10 umfasst ein Gehäuse 12.');
    expect(r.split.claims).toContain('Vorrichtung (10) mit einem Gehäuse (12).');
    expect(r.doc.bytes).toBeInstanceOf(Uint8Array);
  });
  it('returns EN for an English application', () => {
    const r = importPatentDoc(makeDocx(EN_BODY));
    expect(r.lang).toBe('en');
    expect(r.split.claims).toBe('1. A device (10) comprising a housing (12).\n2. A device (10) according to claim 1.');
  });
  it('throws a DocxError for a non-Word file', () => {
    expect(() => importPatentDoc(new Uint8Array([1, 2, 3, 4, 5]))).toThrow();
  });
});

describe('exportPatentDoc', () => {
  it('round-trips into the original file when the buffers were imported', () => {
    const imported = importPatentDoc(makeDocx(EN_BODY));
    const edited = imported.split.description.replace('housing 12', 'housing 14');
    const { bytes, mode } = exportPatentDoc(imported, { description: edited, claims: imported.split.claims });
    expect(mode).toBe('roundTrip');
    const xml = documentXmlOf(bytes);
    expect(xml).toContain('housing 14');
    expect(xml).toContain('A device 10 is disclosed.'); // untouched abstract survives
  });
  it('generates a fresh document when there is no imported source', () => {
    const { bytes, mode } = exportPatentDoc(null, {
      description: 'The device 10 comprises a housing 12.',
      claims: '1. A device (10).',
    }, { claimsHeading: 'Claims' });
    expect(mode).toBe('fresh');
    const again = splitPatentDoc(readDocx(bytes));
    expect(again.claims).toBe('1. A device (10).');
    expect(again.detected.claimsHeading).toBe('Claims');
  });
  it('a fresh German export uses the German claims heading', () => {
    const { bytes } = exportPatentDoc(null,
      { description: 'Die Vorrichtung 10.', claims: '1. Vorrichtung (10).' },
      { claimsHeading: 'Patentansprüche' });
    const again = splitPatentDoc(readDocx(bytes));
    expect(again.lang).toBe('de');
    expect(again.claims).toBe('1. Vorrichtung (10).');
  });
});
