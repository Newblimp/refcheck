// Unit tests for the claim-numbering decisions. write.test.js exercises these
// end to end through exported files; this file pins the rules themselves, which
// is where the reasoning actually lives.
import { describe, it, expect } from 'vitest';
import {
  NUMPR_RE,
  isClaimLine,
  stripAutoNumber,
  claimListTemplate,
  conformClaim,
} from './claimNumbering.ts';

const NUMPR = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';

/** A paragraph as the reader would hand it over. */
const p = (over = {}) => ({
  text: '',
  style: '',
  numbered: false,
  numId: null,
  ilvl: 0,
  bold: false,
  ...over,
  src: {
    xmlStart: 0,
    xmlEnd: 0,
    pPrXml: '',
    rPrXml: '',
    pAttrs: '',
    synthesizedPrefix: '',
    ...(over.src || {}),
  },
});

const listItem = (over = {}) =>
  p({
    numbered: true,
    numId: 1,
    ...over,
    src: { pPrXml: `<w:pPr>${NUMPR}</w:pPr>`, synthesizedPrefix: '1. ', ...(over.src || {}) },
  });

describe('isClaimLine', () => {
  it.each([
    ['1. A device.', true],
    ['12) A device.', true],
    ['  3.  A device.', true],
    ['A device comprising…', false],
    ['What is claimed is:', false],
    ['I. A method step.', false], // a Roman step is not a claim number
    ['12345. too many digits', false],
  ])('%s → %s', (line, want) => {
    expect(isClaimLine(line)).toBe(want);
  });
});

describe('stripAutoNumber', () => {
  it('removes any leading claim number when the number is Word’s', () => {
    // Not just the recorded prefix: inserting a claim renumbers the ones below,
    // so the paragraph whose prefix was "2. " now reads "3. ".
    expect(stripAutoNumber('3. A device.', listItem())).toBe('A device.');
  });
  it('leaves a typed number alone', () => {
    expect(stripAutoNumber('3. A device.', p())).toBe('3. A device.');
  });
});

describe('claimListTemplate', () => {
  it('finds the paragraph that proves the section is a Word list', () => {
    const tpl = listItem();
    expect(claimListTemplate([p({ text: 'What is claimed is:' }), tpl])).toBe(tpl);
  });
  it('returns null when the numbers are typed into the text', () => {
    expect(claimListTemplate([p({ text: '1. A device.' })])).toBeNull();
  });
  it('ignores multi-level numbering, which docSplit refuses to guess at', () => {
    const deep = listItem({ ilvl: 1, src: { synthesizedPrefix: '' } });
    expect(claimListTemplate([deep])).toBeNull();
  });
});

describe('conformClaim', () => {
  const tpl = listItem();

  it('puts a claim into the list and drops its typed number', () => {
    const plain = p({ text: 'Dated: 2026.' });
    const { para, text } = conformClaim(plain, '2. A device (10).', tpl);
    expect(text).toBe('A device (10).');
    expect(para.numbered).toBe(true);
    expect(para.src.pPrXml).toContain('<w:numPr>');
  });

  it('leaves a lead-in line out of the list — it is not a claim', () => {
    const plain = p({ text: 'What is claimed is:' });
    const { para, text } = conformClaim(plain, 'What is claimed is:', tpl);
    expect(text).toBe('What is claimed is:');
    expect(para.src.pPrXml).not.toContain('<w:numPr>');
  });

  it('un-lists a paragraph when the section types its numbers', () => {
    const { para, text } = conformClaim(listItem(), '2. A device (10).', null);
    expect(text).toBe('2. A device (10).'); // the typed number IS the number
    expect(para.numbered).toBe(false);
    expect(para.src.pPrXml).not.toContain('<w:numPr>');
    expect(para.src.synthesizedPrefix).toBe('');
  });

  it('leaves multi-level numbering exactly as it found it', () => {
    const deep = p({ numbered: true, ilvl: 1, src: { pPrXml: `<w:pPr>${NUMPR}</w:pPr>` } });
    const { para, text } = conformClaim(deep, '1.1. A device.', tpl);
    expect(para).toBe(deep);
    expect(text).toBe('1.1. A device.');
  });
});

describe('NUMPR_RE', () => {
  it('removes both the long and the self-closing form', () => {
    expect(`<w:pPr>${NUMPR}<w:ind w:left="720"/></w:pPr>`.replace(NUMPR_RE, '')).toBe(
      '<w:pPr><w:ind w:left="720"/></w:pPr>'
    );
    expect('<w:pPr><w:numPr/></w:pPr>'.replace(NUMPR_RE, '')).toBe('<w:pPr></w:pPr>');
  });
});
