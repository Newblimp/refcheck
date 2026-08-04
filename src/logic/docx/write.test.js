import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { alignLines, planEdits, writeDocx, createDocx, documentXmlOf } from './write.js';
import { readDocx, docxXmlToParagraphs } from './read.js';
import { splitPatentDoc } from '../docSplit.js';
import { para, makeDocx, DE_BODY, EN_BODY } from './fixture.js';

const load = body => {
  const doc = readDocx(makeDocx(body));
  return { doc, split: splitPatentDoc(doc) };
};

describe('alignLines', () => {
  it('maps identical arrays one to one', () => {
    const { map, tail } = alignLines(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(map).toEqual([0, 1, 2]);
    expect(tail).toEqual([]);
  });
  it('maps a changed line in place', () => {
    const { map } = alignLines(['a', 'b', 'c'], ['a', 'B!', 'c']);
    expect(map).toEqual([0, 1, 2]);
  });
  it('marks a deleted line as null', () => {
    const { map } = alignLines(['a', 'b', 'c'], ['a', 'c']);
    expect(map[1]).toBeNull();
    expect(map[2]).toBe(1);
  });
  it('reports appended lines as tail', () => {
    const { map, tail } = alignLines(['a', 'b'], ['a', 'b', 'c']);
    expect(map).toEqual([0, 1]);
    expect(tail).toEqual(['c']);
  });
  it('attaches an inserted middle line to the preceding line', () => {
    const { insertAfter } = alignLines(['a', 'b'], ['a', 'NEW', 'b']);
    expect([...insertAfter.values()].flat()).toContain('NEW');
  });
});

describe('planEdits', () => {
  it('produces nothing when the text is unchanged', () => {
    const { split } = load(EN_BODY);
    expect(planEdits(split.descParas, split.description)).toEqual([]);
    expect(planEdits(split.claimsParas, split.claims)).toEqual([]);
  });
  it('rewrites only the paragraph that changed', () => {
    const { split } = load(EN_BODY);
    const edited = split.description.replace('housing 12 is made', 'housing 14 is made');
    const edits = planEdits(split.descParas, edited);
    expect(edits).toHaveLength(1);
    expect(edits[0].xml).toContain('The housing 14 is made of aluminium.');
  });
});

describe('writeDocx — round trip', () => {
  it('applies the edit and leaves everything else byte-identical', () => {
    const { doc, split } = load(EN_BODY);
    const before = doc.documentXml;
    const edited = split.description.replace('housing 12 is made', 'housing 14 is made');
    const xml = documentXmlOf(writeDocx(doc, [
      { paras: split.descParas, text: edited },
      { paras: split.claimsParas, text: split.claims },
    ]));
    expect(xml).toContain('The housing 14 is made of aluminium.');
    expect(xml).not.toContain('The housing 12 is made of aluminium.');
    // Untouched paragraphs, and the sections we never imported, survive.
    expect(xml).toContain('The device 10 comprises a housing 12.');
    expect(xml).toContain('A device 10 is disclosed.');       // abstract
    expect(xml).toContain('Fig. 1 shows a device 10.');       // figure listing
    // Everything before the first edit is unchanged, character for character.
    const cut = before.indexOf('The housing 12');
    expect(xml.slice(0, cut)).toBe(before.slice(0, cut));
  });
  it('preserves the other parts of the zip', () => {
    const { doc, split } = load(EN_BODY);
    const out = writeDocx(doc, [{ paras: split.descParas, text: split.description + ' Extra.' }]);
    expect(Object.keys(unzipSync(out)).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'word/comments.xml', 'word/document.xml', 'word/footer1.xml', 'word/header1.xml']
    );
  });
  it('keeps the paragraph properties and the first run formatting', () => {
    const body = para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
      para('The device 10.', { style: 'BodyText', italic: true });
    const { doc, split } = load(body);
    const xml = documentXmlOf(writeDocx(doc, [{ paras: split.descParas, text: 'The device 14.' }]));
    expect(xml).toContain('<w:pStyle w:val="BodyText"/>');
    expect(xml).toContain('<w:rPr><w:i/></w:rPr>');
    expect(xml).toContain('The device 14.');
  });
  it('does NOT write synthesized claim numbers back (Word would double-number)', () => {
    const { doc, split } = load(DE_BODY);
    expect(split.claims).toContain('1. Vorrichtung');
    const edited = split.claims.replace('Gehäuse (12)', 'Gehäuse (14)');
    const xml = documentXmlOf(writeDocx(doc, [{ paras: split.claimsParas, text: edited }]));
    expect(xml).toContain('Vorrichtung (10) mit einem Gehäuse (14).');
    expect(xml).not.toContain('>1. Vorrichtung');
    expect(xml).not.toContain('1. Vorrichtung (10) mit einem Gehäuse (14).');
  });
  it('escapes XML metacharacters written back into the document', () => {
    const { doc, split } = load(EN_BODY);
    const xml = documentXmlOf(writeDocx(doc, [
      { paras: split.descParas, text: 'a & b < c > d' },
    ]));
    expect(xml).toContain('a &amp; b &lt; c &gt; d');
  });
  it('separate paragraphs stay separate paragraphs, not a <w:br/> run', () => {
    const { doc, split } = load(EN_BODY);
    const xml = documentXmlOf(writeDocx(doc, [{ paras: split.descParas, text: 'one\ntwo' }]));
    expect(xml).toContain('<w:t xml:space="preserve">one</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve">two</w:t>');
    expect(xml).not.toContain('<w:br/>');
  });
  it('a paragraph that spanned lines via <w:br/> keeps its break when edited', () => {
    const body = para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
      '<w:p><w:r><w:t>line one 10</w:t><w:br/><w:t>line two 12</w:t></w:r></w:p>';
    const { doc, split } = load(body);
    expect(split.description).toBe('line one 10\nline two 12');
    expect(split.descParas).toHaveLength(1);
    const xml = documentXmlOf(writeDocx(doc, [
      { paras: split.descParas, text: 'line one 10\nline two 14' },
    ]));
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('line two 14');
    expect(docxXmlToParagraphs(xml).map(p => p.text)).toContain('line one 10\nline two 14');
  });
  it('appends brand-new trailing paragraphs', () => {
    const { doc, split } = load(EN_BODY);
    const xml = documentXmlOf(writeDocx(doc, [
      { paras: split.descParas, text: `${split.description}\nA newly added sentence 20.` },
    ]));
    expect(xml).toContain('A newly added sentence 20.');
  });
  it('the result re-imports to the edited text (full round trip)', () => {
    const { doc, split } = load(DE_BODY);
    const edited = split.description.replace('Gehäuse 12', 'Gehäuse 14');
    const out = writeDocx(doc, [
      { paras: split.descParas, text: edited },
      { paras: split.claimsParas, text: split.claims },
    ]);
    const again = splitPatentDoc(readDocx(out));
    expect(again.description).toBe(edited);
    expect(again.claims).toBe(split.claims);
    expect(again.lang).toBe('de');
  });
});

describe('createDocx', () => {
  it('builds a readable document from plain text', () => {
    const bytes = createDocx([
      { text: 'The device 10 comprises a housing 12.' },
      { heading: 'Claims', text: '1. A device (10).' },
    ]);
    const paras = docxXmlToParagraphs(documentXmlOf(bytes)).map(p => p.text);
    expect(paras).toContain('The device 10 comprises a housing 12.');
    expect(paras).toContain('Claims');
    expect(paras).toContain('1. A device (10).');
  });
  it('produces a file the reader accepts', () => {
    const doc = readDocx(createDocx([{ text: 'x 10' }]));
    expect(doc.paragraphs.map(p => p.text)).toEqual(['x 10']);
  });
});
