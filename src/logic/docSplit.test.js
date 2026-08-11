import { describe, it, expect } from 'vitest';
import { splitPatentDoc, refListWritable } from './docSplit.ts';
import { docxXmlToParagraphs } from './docx/read.ts';
import { para, DE_BODY, EN_BODY } from './docx/fixture.ts';

const split = (body) => splitPatentDoc({ paragraphs: docxXmlToParagraphs(body) });

describe('splitPatentDoc — German application', () => {
  const r = split(DE_BODY);
  it('takes only the detailed description into the description buffer', () => {
    expect(r.description).toBe(
      'Die Vorrichtung 10 umfasst ein Gehäuse 12.\nDas Gehäuse 12 besteht aus Aluminium.'
    );
  });
  it('excludes the abstract, the figure listing and the Bezugszeichenliste', () => {
    expect(r.description).not.toContain('Die Erfindung betrifft'); // abstract
    expect(r.description).not.toContain('Fig. 1 zeigt'); // figure listing
    expect(r.description).not.toContain('10 Vorrichtung'); // sign list
    expect(r.claims).not.toContain('10 Vorrichtung');
  });
  it('takes the claims and derives the language from the headings', () => {
    expect(r.claims).toContain('Vorrichtung (10) mit einem Gehäuse (12).');
    expect(r.lang).toBe('de');
    expect(r.detected.claimsHeading).toBe('Patentansprüche');
    expect(r.detected.descHeading).toBe('Detaillierte Beschreibung');
    expect(r.detected.fellBack).toBe(false);
  });
});

describe('splitPatentDoc — English application', () => {
  const r = split(EN_BODY);
  it('slices on the English headings and reports EN', () => {
    expect(r.description).toBe(
      'The device 10 comprises a housing 12.\nThe housing 12 is made of aluminium.'
    );
    expect(r.claims).toBe(
      '1. A device (10) comprising a housing (12).\n2. A device (10) according to claim 1.'
    );
    expect(r.lang).toBe('en');
  });
  it('does not renumber claims that already carry typed numbers', () => {
    expect(r.detected.synthesizedClaimNumbers).toBe(0);
  });
});

describe('splitPatentDoc — auto-numbered claims', () => {
  it('synthesizes the numbers Word would have rendered', () => {
    const r = split(DE_BODY);
    // The DE fixture's claims use <w:numPr>, so the text carries no digits.
    expect(r.claims.split('\n')[0]).toMatch(/^1\. /);
    expect(r.claims.split('\n')[1]).toMatch(/^2\. /);
    expect(r.detected.synthesizedClaimNumbers).toBe(2);
    expect(r.detected.unusualNumbering).toBe(false);
  });
  it('records the synthesized prefix so export can strip it again', () => {
    const r = split(DE_BODY);
    expect(r.claimsParas[0].src.synthesizedPrefix).toBe('1. ');
  });
  it('leaves a paragraph that already starts with a number alone', () => {
    const body = para('Claims', { style: 'Heading1' }) + para('1. A device (10).', { num: true });
    const r = split(body);
    expect(r.claims).toBe('1. A device (10).');
    expect(r.detected.synthesizedClaimNumbers).toBe(0);
  });
  it('flags multi-level numbering instead of guessing at it', () => {
    const body =
      para('Claims', { style: 'Heading1' }) +
      para('A device (10).', { num: true }) +
      para('a sub-feature', { num: true, ilvl: 1 });
    const r = split(body);
    expect(r.detected.unusualNumbering).toBe(true);
  });
  it('counts each numbering list separately', () => {
    const body =
      para('Claims', { style: 'Heading1' }) +
      para('first', { num: true, numId: 1 }) +
      para('second', { num: true, numId: 1 }) +
      para('other list', { num: true, numId: 7 });
    expect(split(body).claims).toBe('1. first\n2. second\n1. other list');
  });
});

describe('splitPatentDoc — fallbacks', () => {
  it('falls back to the whole document when no description heading exists', () => {
    const body = para('Some prose about a device 10.') + para('More prose about a housing 12.');
    const r = split(body);
    expect(r.detected.fellBack).toBe(true);
    expect(r.detected.description).toBe(false);
    expect(r.description).toContain('Some prose about a device 10.');
    expect(r.claims).toBe('');
  });
  it('falls back to everything before the claims when only claims are found', () => {
    const body =
      para('Prose about a device 10.') +
      para('CLAIMS', { style: 'Heading1' }) +
      para('1. A device (10).');
    const r = split(body);
    expect(r.detected.fellBack).toBe(true);
    expect(r.description).toBe('Prose about a device 10.');
    expect(r.claims).toBe('1. A device (10).');
    expect(r.lang).toBe('en');
  });
  it('leaves claims empty and says so when there is no claims heading', () => {
    const body = para('DETAILED DESCRIPTION', { style: 'Heading1' }) + para('The device 10.');
    const r = split(body);
    expect(r.claims).toBe('');
    expect(r.detected.claims).toBe(false);
    expect(r.description).toBe('The device 10.');
  });
  it('returns empty buffers for an empty document', () => {
    const r = splitPatentDoc({ paragraphs: [] });
    expect(r.description).toBe('');
    expect(r.claims).toBe('');
    expect(r.lang).toBeNull();
  });
});

describe('splitPatentDoc — boundary precision', () => {
  it('does not end the description on a sentence mentioning "Ansprüche"', () => {
    const body =
      para('Detaillierte Beschreibung', { style: 'Heading1' }) +
      para('Die Vorrichtung 10 gemäß den Ansprüchen 1 bis 4 weist ein Gehäuse 12 auf.') +
      para('Das Gehäuse 12 ist aus Alu.') +
      para('Patentansprüche', { style: 'Heading1' }) +
      para('Vorrichtung (10).');
    const r = split(body);
    expect(r.description).toContain('gemäß den Ansprüchen 1 bis 4');
    expect(r.description).toContain('Das Gehäuse 12 ist aus Alu.');
    expect(r.claims).toBe('Vorrichtung (10).');
  });
  it('trims blank paragraphs from the edges of each buffer', () => {
    const body =
      para('CLAIMS', { style: 'Heading1' }) + '<w:p/>' + para('1. A device (10).') + '<w:p/>';
    expect(split(body).claims).toBe('1. A device (10).');
  });
});

describe('reference-sign list', () => {
  // The list is excluded from both buffers by design, but it is exactly what
  // the reference-list check wants, so it is returned rather than discarded.
  it('returns the Bezugszeichenliste separately', () => {
    const r = split(DE_BODY);
    expect(r.signList).toBe('10 Vorrichtung\n12 Gehäuse');
    expect(r.detected.signList).toBe(true);
  });

  it('keeps the list out of the description and claims buffers', () => {
    const r = split(DE_BODY);
    expect(r.description).not.toMatch(/Vorrichtung$/m);
    expect(r.claims).not.toContain('10 Vorrichtung');
  });

  it('reports no list when the document has no such heading', () => {
    const r = split(EN_BODY);
    expect(r.signList).toBe('');
    expect(r.detected.signList).toBe(false);
  });

  it('stops at the claims heading when the list is placed before the claims', () => {
    // Common layout: Description -> reference signs list -> Claims, rather
    // than Description -> Claims -> reference signs list.
    const body =
      para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
      para('The device 10 comprises a housing 12.') +
      para('LIST OF REFERENCE SIGNS', { style: 'Heading1' }) +
      para('10 device') +
      para('12 housing') +
      para('PATENT CLAIMS', { style: 'Heading1' }) +
      para('1. A device (10) comprising a housing (12).');
    const r = split(body);
    expect(r.signList).toBe('10 device\n12 housing');
    expect(r.claims).toBe('1. A device (10) comprising a housing (12).');
    expect(r.signList).not.toContain('PATENT CLAIMS');
  });
});

// Export rewrites the paragraphs a buffer came from. For the reference-sign
// list that is only safe when the source marks it out unambiguously — the three
// ways it does not would each damage the file rather than update it.
describe('refListWritable', () => {
  const H = (t) => para(t, { style: 'Heading1' });
  const check = (body) => refListWritable(split(body));

  it('accepts a list that is its own section of plain paragraphs', () => {
    const body = [
      H('DETAILED DESCRIPTION'),
      para('The device 10 comprises a housing 12.'),
      H('CLAIMS'),
      para('1. A device (10).'),
      H('LIST OF REFERENCE SIGNS'),
      para('10 device'),
      para('12 housing'),
    ].join('');
    expect(check(body)).toEqual({ ok: true });
  });

  it('refuses when the document has no reference-sign section', () => {
    const body = [
      H('DETAILED DESCRIPTION'),
      para('The device 10 comprises a housing 12.'),
      H('CLAIMS'),
      para('1. A device (10).'),
    ].join('');
    expect(check(body)).toEqual({ ok: false, reason: 'noSection' });
  });

  it('refuses when the list is also inside the description buffer', () => {
    // No detailed-description heading, so the splitter falls back to
    // "everything before the claims" — which swallows the list. Both buffers
    // would then plan edits over the same bytes of document.xml.
    const body = [
      para('The device 10 comprises a housing 12.'),
      H('LIST OF REFERENCE SIGNS'),
      para('10 device'),
      H('CLAIMS'),
      para('1. A device (10).'),
    ].join('');
    const r = split(body);
    expect(r.detected.fellBack).toBe(true);
    // The overlap is real, not merely suspected.
    const hit = r.descParas.some((d) =>
      r.signListParas.some((g) => d.src.xmlStart < g.src.xmlEnd && g.src.xmlStart < d.src.xmlEnd)
    );
    expect(hit).toBe(true);
    expect(check(body)).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('refuses a list laid out as a table', () => {
    // Every cell is its own <w:p>, so the buffer reads "10 / device" down the
    // lines; diffing edited text against that moves values between cells.
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
    expect(split(body).signListParas.every((p) => p.inTable)).toBe(true);
    expect(check(body)).toEqual({ ok: false, reason: 'table' });
  });
});

// Export splices into the paragraphs a buffer names, so two buffers naming the
// same paragraph means two texts written over one range — and one of them lost.
// The stop-kind lists alone do not guarantee this: they assume the usual section
// order, and a document does not have to be in it.
describe('sections never overlap', () => {
  const indicesOf = (paras) => paras.map((p) => p.src.xmlStart);
  const disjoint = (r) => {
    const all = [
      ...indicesOf(r.descParas),
      ...indicesOf(r.claimsParas),
      ...indicesOf(r.signListParas),
    ];
    return new Set(all).size === all.length;
  };

  it('when the claims come before the description (an amendment sheet)', () => {
    const body =
      para('PATENT CLAIMS', { style: 'Heading1' }) +
      para('1. A device (10).') +
      para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
      para('The device 10 comprises a housing 12.');
    const r = split(body);
    expect(r.claims).toBe('1. A device (10).');
    expect(r.description).toBe('The device 10 comprises a housing 12.');
    expect(disjoint(r)).toBe(true);
  });

  it('when the sign list comes before the description', () => {
    const body =
      para('LIST OF REFERENCE SIGNS', { style: 'Heading1' }) +
      para('10 device') +
      para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
      para('The device 10 comprises a housing 12.') +
      para('CLAIMS', { style: 'Heading1' }) +
      para('1. A device (10).');
    const r = split(body);
    expect(r.signList).toBe('10 device');
    expect(r.description).toBe('The device 10 comprises a housing 12.');
    expect(r.claims).toBe('1. A device (10).');
    expect(disjoint(r)).toBe(true);
  });

  it('in the ordinary layouts too', () => {
    expect(disjoint(split(EN_BODY))).toBe(true);
    expect(disjoint(split(DE_BODY))).toBe(true);
  });

  it('does not truncate a description at its own sub-heading', () => {
    // "Ausführungsbeispiel 2" matches the detailed-description prefix. Clipping
    // at every heading of a section KIND — rather than at the sections actually
    // located — would cut the description in half here.
    const body =
      para('Detaillierte Beschreibung', { style: 'Heading1' }) +
      para('Die Vorrichtung 10 umfasst ein Gehäuse 12.') +
      para('Ausführungsbeispiel 2', { style: 'Heading2' }) +
      para('Das Gehäuse 12 ist aus Aluminium.') +
      para('Patentansprüche', { style: 'Heading1' }) +
      para('1. Vorrichtung (10).');
    const r = split(body);
    expect(r.description).toContain('Das Gehäuse 12 ist aus Aluminium.');
    expect(r.claims).toBe('1. Vorrichtung (10).');
  });
});
