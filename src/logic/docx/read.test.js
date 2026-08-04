import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { docxXmlToParagraphs, decodeXml, readDocx, DocxError } from './read.js';
import { para, documentXml, makeDocx, DE_BODY } from './fixture.js';

const texts = xml => docxXmlToParagraphs(xml).map(p => p.text);

describe('decodeXml', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXml('a &amp; b')).toBe('a & b');
    expect(decodeXml('&lt;tag&gt; &quot;q&quot; &apos;a&apos;')).toBe('<tag> "q" \'a\'');
    expect(decodeXml('&#65;&#x42;')).toBe('AB');
  });
  it('leaves text without entities untouched', () => {
    expect(decodeXml('plain text 12')).toBe('plain text 12');
  });
});

describe('docxXmlToParagraphs', () => {
  it('joins runs inside a paragraph with NO separator', () => {
    // Word splits words across runs constantly; a separator would give "hous ing".
    const xml = '<w:p><w:r><w:t>hous</w:t></w:r><w:r><w:t>ing</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> 12</w:t></w:r></w:p>';
    expect(texts(xml)).toEqual(['housing 12']);
  });
  it('honours xml:space="preserve" for leading and trailing spaces', () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve">a </w:t></w:r><w:r><w:t xml:space="preserve"> b</w:t></w:r></w:p>';
    expect(texts(xml)).toEqual(['a  b']);
  });
  it('maps <w:tab/> to a tab and <w:br/> to a newline', () => {
    const xml = '<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>';
    expect(texts(xml)).toEqual(['a\tb\nc']);
  });
  it('keeps an empty paragraph as its own (blank) line', () => {
    expect(texts(para('a') + '<w:p/>' + para('b'))).toEqual(['a', '', 'b']);
  });
  it('reads pStyle, numbering and bold', () => {
    const ps = docxXmlToParagraphs(
      para('Claims', { style: 'Heading1', bold: true }) + para('A device', { num: true, numId: 3 })
    );
    expect(ps[0].style).toBe('Heading1');
    expect(ps[0].bold).toBe(true);
    expect(ps[0].numbered).toBe(false);
    expect(ps[1].numbered).toBe(true);
    expect(ps[1].numId).toBe(3);
    expect(ps[1].ilvl).toBe(0);
  });
  it('treats <w:b w:val="0"/> as not bold', () => {
    const xml = '<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>x</w:t></w:r></w:p>';
    expect(docxXmlToParagraphs(xml)[0].bold).toBe(false);
  });
  it('excludes text-box content (it is inline in document.xml)', () => {
    const xml = '<w:p><w:r><w:t>real text</w:t></w:r>' +
      '<w:r><w:txbxContent><w:p><w:r><w:t>floating caption 99</w:t></w:r></w:p></w:txbxContent></w:r></w:p>';
    expect(texts(xml)).toEqual(['real text']);
  });
  it('keeps tracked insertions and drops tracked deletions', () => {
    const xml = '<w:p><w:ins><w:r><w:t>new </w:t></w:r></w:ins>' +
      '<w:del><w:r><w:delText>old </w:delText></w:r></w:del>' +
      '<w:r><w:t>tail</w:t></w:r></w:p>';
    expect(texts(xml)).toEqual(['new tail']);
  });
  it('decodes entities in paragraph text', () => {
    expect(texts('<w:p><w:r><w:t>a &amp; b &lt; c</w:t></w:r></w:p>')).toEqual(['a & b < c']);
  });
  it('records the xml span of each paragraph for round-trip export', () => {
    const xml = documentXml(para('one') + para('two'));
    const ps = docxXmlToParagraphs(xml);
    expect(xml.slice(ps[0].src.xmlStart, ps[0].src.xmlEnd)).toBe(para('one'));
    expect(xml.slice(ps[1].src.xmlStart, ps[1].src.xmlEnd)).toBe(para('two'));
  });
  it('captures pPr and the first run rPr for rebuilding', () => {
    const p = docxXmlToParagraphs(para('x', { style: 'Heading1', italic: true }))[0];
    expect(p.src.pPrXml).toContain('w:pStyle');
    expect(p.src.rPrXml).toBe('<w:rPr><w:i/></w:rPr>');
  });
  it('is safe to run repeatedly (module-level regex lastIndex reset)', () => {
    const xml = para('a') + para('b');
    expect(texts(xml)).toEqual(texts(xml));
  });
});

describe('readDocx', () => {
  it('reads a real zip and excludes headers, footers and comments', () => {
    const doc = readDocx(makeDocx(DE_BODY));
    const all = doc.paragraphs.map(p => p.text).join('\n');
    expect(all).toContain('Die Vorrichtung 10 umfasst ein Gehäuse 12.');
    expect(all).not.toContain('CONFIDENTIAL');   // word/header1.xml
    expect(all).not.toContain('Page 1 of 9');    // word/footer1.xml
    expect(all).not.toContain('Reviewer');       // word/comments.xml
  });
  it('keeps the original bytes and xml for export', () => {
    const bytes = makeDocx(DE_BODY);
    const doc = readDocx(bytes);
    expect(doc.bytes).toBe(bytes);
    expect(doc.documentXml).toContain('<w:body>');
  });
  it('rejects a non-zip (a legacy binary .doc) with code notZip', () => {
    const notAZip = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => readDocx(notAZip)).toThrow(DocxError);
    try { readDocx(notAZip); } catch (e) { expect(e.code).toBe('notZip'); }
  });
  it('rejects a zip without word/document.xml with code noDocument', () => {
    // A valid zip that simply is not a Word document (e.g. an .odt).
    const bad = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text') });
    expect(() => readDocx(bad)).toThrow(DocxError);
    try { readDocx(bad); } catch (e) { expect(e.code).toBe('noDocument'); }
  });
});
