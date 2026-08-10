import { describe, it, expect } from 'vitest';
import { fileKind, importPatentDoc, exportPatentDoc } from './importDoc.js';
import { readDocx } from './docx/read.js';
import { splitPatentDoc } from './docSplit.js';
import { documentXmlOf } from './docx/write.js';
import { para, makeDocx, DE_BODY, EN_BODY } from './docx/fixture.js';

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
    expect(r.split.claims).toBe(
      '1. A device (10) comprising a housing (12).\n2. A device (10) according to claim 1.'
    );
  });
  it('throws a DocxError for a non-Word file', () => {
    expect(() => importPatentDoc(new Uint8Array([1, 2, 3, 4, 5]))).toThrow();
  });
});

describe('exportPatentDoc', () => {
  it('round-trips into the original file when the buffers were imported', () => {
    const imported = importPatentDoc(makeDocx(EN_BODY));
    const edited = imported.split.description.replace('housing 12', 'housing 14');
    const { bytes, mode } = exportPatentDoc(imported, {
      description: edited,
      claims: imported.split.claims,
    });
    expect(mode).toBe('roundTrip');
    const xml = documentXmlOf(bytes);
    expect(xml).toContain('housing 14');
    expect(xml).toContain('A device 10 is disclosed.'); // untouched abstract survives
  });
  it('generates a fresh document when there is no imported source', () => {
    const { bytes, mode } = exportPatentDoc(
      null,
      {
        description: 'The device 10 comprises a housing 12.',
        claims: '1. A device (10).',
      },
      { claimsHeading: 'Claims' }
    );
    expect(mode).toBe('fresh');
    const again = splitPatentDoc(readDocx(bytes));
    expect(again.claims).toBe('1. A device (10).');
    expect(again.detected.claimsHeading).toBe('Claims');
    // With no source document there is no list to match, so the claims are
    // numbered in the text — Word list numbering would put a second number in
    // front of the one the user typed.
    expect(documentXmlOf(bytes)).not.toContain('<w:numPr>');
  });
  it('a fresh German export uses the German claims heading', () => {
    const { bytes } = exportPatentDoc(
      null,
      { description: 'Die Vorrichtung 10.', claims: '1. Vorrichtung (10).' },
      { claimsHeading: 'Patentansprüche' }
    );
    const again = splitPatentDoc(readDocx(bytes));
    expect(again.lang).toBe('de');
    expect(again.claims).toBe('1. Vorrichtung (10).');
  });
});

// The reference-sign list is the third buffer written back into the source. It
// is also the one that can be left out, because the source does not always mark
// it out clearly enough to rewrite — and a wrong guess there damages the file.
describe('exportPatentDoc — the reference list', () => {
  const H = (t) => para(t, { style: 'Heading1' });
  const EDITED = '10 warning device\n12 casing\n14 bee';
  const roundTrip = (body, refList = EDITED) => {
    const imported = importPatentDoc(makeDocx(body));
    const out = exportPatentDoc(imported, {
      description: imported.split.description,
      claims: imported.split.claims,
      refList,
    });
    return { imported, out, again: splitPatentDoc(readDocx(out.bytes)) };
  };
  const plain = [
    H('DETAILED DESCRIPTION'),
    para('The device 10 comprises a housing 12.'),
    H('CLAIMS'),
    para('1. A device (10).'),
    H('LIST OF REFERENCE SIGNS'),
    para('10 device'),
    para('12 housing'),
  ].join('');

  it('writes an edited list back, leaving the other buffers alone', () => {
    const { imported, out, again } = roundTrip(plain);
    expect(out.refList).toBe('written');
    expect(again.signList).toBe(EDITED);
    expect(again.description).toBe(imported.split.description);
    expect(again.claims).toBe(imported.split.claims);
  });

  it('writes nothing at all when the list was not touched', () => {
    const imported = importPatentDoc(makeDocx(plain));
    const out = exportPatentDoc(imported, {
      description: imported.split.description,
      claims: imported.split.claims,
      refList: imported.split.signList,
    });
    expect(out.refList).toBe('unchanged');
    expect(documentXmlOf(out.bytes)).toBe(imported.doc.documentXml);
  });

  it('leaves the file alone and reports why when there is no list section', () => {
    const body = [
      H('DETAILED DESCRIPTION'),
      para('The device 10 comprises a housing 12.'),
      H('CLAIMS'),
      para('1. A device (10).'),
    ].join('');
    const { imported, out, again } = roundTrip(body);
    expect(out.refList).toBe('noSection');
    expect(again.description).toBe(imported.split.description);
    expect(again.claims).toBe(imported.split.claims);
  });

  it('refuses when the list cannot be told apart from the description', () => {
    const body = [
      para('The device 10 comprises a housing 12.'),
      H('LIST OF REFERENCE SIGNS'),
      para('10 device'),
      H('CLAIMS'),
      para('1. A device (10).'),
    ].join('');
    const { out, again } = roundTrip(body);
    expect(out.refList).toBe('ambiguous');
    // The original list survives untouched rather than being half-rewritten.
    expect(again.signList).toBe('10 device');
  });

  it('refuses a table-based list, leaving the table intact', () => {
    const body =
      [
        H('DETAILED DESCRIPTION'),
        para('The device 10 comprises a housing 12.'),
        H('CLAIMS'),
        para('1. A device (10).'),
        H('LIST OF REFERENCE SIGNS'),
      ].join('') +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>device</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const { out } = roundTrip(body);
    expect(out.refList).toBe('table');
    expect(documentXmlOf(out.bytes)).toContain('<w:tbl>');
    expect(documentXmlOf(out.bytes)).toContain('<w:t>device</w:t>');
  });

  it('includes the list as its own section in a from-scratch export', () => {
    const { bytes, refList } = exportPatentDoc(
      null,
      { description: 'The device 10.', claims: '1. A device (10).', refList: EDITED },
      { claimsHeading: 'Claims', refListHeading: 'Reference signs' }
    );
    expect(refList).toBe('written');
    expect(splitPatentDoc(readDocx(bytes)).signList).toBe(EDITED);
  });
});
