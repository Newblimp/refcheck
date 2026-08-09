import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { alignLines, planEdits, writeDocx, createDocx, documentXmlOf } from './write.js';
import { readDocx, docxXmlToParagraphs } from './read.js';
import { splitPatentDoc } from '../docSplit.js';
import { para, makeDocx, DE_BODY, EN_BODY } from './fixture.js';

const load = (body) => {
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
    const xml = documentXmlOf(
      writeDocx(doc, [
        { paras: split.descParas, text: edited },
        { paras: split.claimsParas, text: split.claims },
      ])
    );
    expect(xml).toContain('The housing 14 is made of aluminium.');
    expect(xml).not.toContain('The housing 12 is made of aluminium.');
    // Untouched paragraphs, and the sections we never imported, survive.
    expect(xml).toContain('The device 10 comprises a housing 12.');
    expect(xml).toContain('A device 10 is disclosed.'); // abstract
    expect(xml).toContain('Fig. 1 shows a device 10.'); // figure listing
    // Everything before the first edit is unchanged, character for character.
    const cut = before.indexOf('The housing 12');
    expect(xml.slice(0, cut)).toBe(before.slice(0, cut));
  });
  it('preserves the other parts of the zip', () => {
    const { doc, split } = load(EN_BODY);
    const out = writeDocx(doc, [{ paras: split.descParas, text: split.description + ' Extra.' }]);
    expect(Object.keys(unzipSync(out)).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/comments.xml',
      'word/document.xml',
      'word/footer1.xml',
      'word/header1.xml',
    ]);
  });
  it('keeps the paragraph properties and the first run formatting', () => {
    const body =
      para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
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
    const xml = documentXmlOf(writeDocx(doc, [{ paras: split.descParas, text: 'a & b < c > d' }]));
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
    const body =
      para('DETAILED DESCRIPTION', { style: 'Heading1' }) +
      '<w:p><w:r><w:t>line one 10</w:t><w:br/><w:t>line two 12</w:t></w:r></w:p>';
    const { doc, split } = load(body);
    expect(split.description).toBe('line one 10\nline two 12');
    expect(split.descParas).toHaveLength(1);
    const xml = documentXmlOf(
      writeDocx(doc, [{ paras: split.descParas, text: 'line one 10\nline two 14' }])
    );
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('line two 14');
    expect(docxXmlToParagraphs(xml).map((p) => p.text)).toContain('line one 10\nline two 14');
  });
  it('appends brand-new trailing paragraphs', () => {
    const { doc, split } = load(EN_BODY);
    const xml = documentXmlOf(
      writeDocx(doc, [
        { paras: split.descParas, text: `${split.description}\nA newly added sentence 20.` },
      ])
    );
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

// Every exported claim has to land at the same alignment as its neighbours.
// Word takes both the indent and the list number from the PARAGRAPH, so a claim
// that ends up as a <w:br/> inside the previous one, or in a blank spacer
// paragraph, or cloned from one, renders shifted and unnumbered — while the
// buffer the user was looking at said nothing of the sort.
describe('exported claims keep one alignment', () => {
  const claimsBody = (...claims) =>
    [
      para('CLAIMS', { style: 'Heading1' }),
      ...claims,
      para('REFERENCE SIGNS', { style: 'Heading1' }),
      para('1 warning device'),
    ].join('');
  // A claim with the hanging indent a real draft uses, numbered in the text.
  const IND = '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>';
  const indented = (t) => `<w:p>${IND}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

  const paras = (xml) => xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const claimParas = (xml) => paras(xml).filter((p) => /A warning device|A device \(1\)/.test(p));
  const pPrOf = (p) => (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const textOf = (p) =>
    (p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');

  const exportClaims = (body, text) => {
    const { doc, split } = load(body);
    return documentXmlOf(writeDocx(doc, [{ paras: split.claimsParas, text, claims: true }]));
  };

  // The reported case: two claims typed over an imported set.
  const TWO = '1. A warning device (1) with a bee.\n2. A warning device (1) without a bee.';

  it('gives an added claim its own paragraph, not a <w:br/> inside the one above', () => {
    // Both neighbours stay byte-identical, so the new claim is a pure insertion
    // — the shape that used to be folded in as a soft break.
    const xml = exportClaims(
      claimsBody(indented('1. A device (1).'), indented('2. A device (1) of claim 1.')),
      '1. A device (1).\n1a. A warning device (1) with a bee.\n2. A device (1) of claim 1.'
    );
    expect(xml).not.toContain('<w:br/>');
    const cs = claimParas(xml);
    expect(cs).toHaveLength(3);
    expect(cs.map(textOf)).toEqual([
      '1. A device (1).',
      '1a. A warning device (1) with a bee.',
      '2. A device (1) of claim 1.',
    ]);
    // The point of the exercise: identical paragraph properties throughout.
    expect(new Set(cs.map(pPrOf)).size).toBe(1);
    expect(pPrOf(cs[1])).toContain('w:hanging="360"');
  });

  it('numbers an inserted claim as a list item when the source was a list', () => {
    const xml = exportClaims(
      claimsBody(
        para('A device (1).', { num: true }),
        para('A device (1) of claim 1.', { num: true })
      ),
      '1. A device (1).\n2. A warning device (1) with a bee.\n2. A device (1) of claim 1.'
    );
    const cs = claimParas(xml);
    expect(cs).toHaveLength(3);
    expect(cs.every((p) => /<w:numPr>/.test(p))).toBe(true);
    // Word supplies the number, so the typed one must not survive as text.
    expect(textOf(cs[1])).toBe('A warning device (1) with a bee.');
  });

  it('strips the typed number when an edit renumbers an auto-numbered claim', () => {
    // The paragraph whose synthesized prefix was "2. " now reads "3. ", so
    // matching the recorded prefix is not enough to catch it.
    const xml = exportClaims(
      claimsBody(
        para('A device (1).', { num: true }),
        para('A device (1) of claim 1.', { num: true })
      ),
      '1. A device (1).\n3. A warning device (1) with a bee.'
    );
    expect(textOf(claimParas(xml)[1])).toBe('A warning device (1) with a bee.');
  });

  it('does not double-number a claim appended past the end of a list', () => {
    const xml = exportClaims(claimsBody(para('A device (1).', { num: true })), TWO);
    const cs = claimParas(xml);
    expect(cs).toHaveLength(2);
    expect(cs.every((p) => /<w:numPr>/.test(p))).toBe(true);
    expect(cs.map(textOf)).toEqual([
      'A warning device (1) with a bee.',
      'A warning device (1) without a bee.',
    ]);
  });

  it('writes a claim into a claim paragraph, never into a blank spacer', () => {
    // Claims separated by empty paragraphs: pairing line for line used to drop
    // claim 2 into the spacer and delete the paragraph that carried the indent.
    const xml = exportClaims(
      claimsBody(indented('1. A device (1).'), para(''), indented('2. A device (1) of claim 1.')),
      TWO
    );
    const cs = claimParas(xml);
    expect(cs).toHaveLength(2);
    expect(cs.map(textOf)).toEqual([
      '1. A warning device (1) with a bee.',
      '2. A warning device (1) without a bee.',
    ]);
    expect(new Set(cs.map(pPrOf)).size).toBe(1);
    expect(pPrOf(cs[1])).toContain('w:hanging="360"');
    // The spacer had no text to keep, so it goes rather than being repurposed.
    expect(paras(xml).filter((p) => textOf(p) === '' && /w:hanging/.test(p))).toHaveLength(0);
  });

  it('clones a real claim when the last paragraph of the section is blank', () => {
    const text = `${TWO}\n3. A warning device (1) with two bees.`;
    const body = claimsBody(para('A device (1).', { num: true }), para(''));
    const xml = exportClaims(body, text);
    const cs = claimParas(xml);
    expect(cs).toHaveLength(3);
    expect(cs.every((p) => /<w:numPr>/.test(p))).toBe(true);
    expect(textOf(cs[2])).toBe('A warning device (1) with two bees.');
    // ...and they follow the last claim, not the trailing spacer — appending
    // after that opens a blank line the buffer never had.
    const { doc, split } = load(body);
    const out = writeDocx(doc, [{ paras: split.claimsParas, text, claims: true }]);
    expect(splitPatentDoc(readDocx(out)).claims).toBe(text);
  });

  it('keeps an added blank line out of the numbering', () => {
    // An empty list item still consumes a claim number in Word.
    const xml = exportClaims(
      claimsBody(
        para('A device (1).', { num: true }),
        para('A device (1) of claim 1.', { num: true })
      ),
      '1. A device (1).\n\n2. A device (1) of claim 1.'
    );
    const blanks = paras(xml).filter((p) => textOf(p) === '' && !/CLAIMS|REFERENCE/.test(p));
    expect(blanks).toHaveLength(1);
    expect(blanks[0]).not.toContain('<w:numPr>');
  });

  it('survives the round trip: the re-imported claims match the buffer', () => {
    const { doc, split } = load(
      claimsBody(
        para('A device (1).', { num: true }),
        para('A device (1) of claim 1.', { num: true })
      )
    );
    const out = writeDocx(doc, [
      { paras: split.descParas, text: split.description },
      { paras: split.claimsParas, text: TWO, claims: true },
    ]);
    expect(splitPatentDoc(readDocx(out)).claims).toBe(TWO);
  });
});

// Whichever paragraph a claim line lands in is an artefact of the diff; how the
// section numbers its claims is not. A .docx whose claims are a Word list must
// export claims that are ALL list items; one with numbers typed into the text
// must export claims that are all plain text, with no <w:numPr> to add a second
// number in front of the typed one.
describe('exported claims keep the source numbering style', () => {
  const section = (...claims) => [para('CLAIMS', { style: 'Heading1' }), ...claims].join('');
  const num = (t) => para(t, { num: true });
  const NEW = '1. A claim with a bee (2)\n2. The claim according to claim 1.';

  const claimsOf = (body, text = NEW) => {
    const { doc, split } = load(body);
    const xml = documentXmlOf(writeDocx(doc, [{ paras: split.claimsParas, text, claims: true }]));
    return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
      .map((p) => ({
        list: /<w:numPr>/.test(p),
        text: (p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, ''))
          .join(''),
      }))
      .filter((p) => p.text.trim() && p.text !== 'CLAIMS');
  };

  it('keeps every claim in the list when the source is a Word list', () => {
    for (const source of [
      section(num('A device (1).'), num('A device (1) of claim 1.')),
      section(num('A device (1).')), // one claim, so the second is appended
      section(num('A device (1).'), num('A d (1) of c1.'), num('A d (1) of c2.')),
    ]) {
      const cs = claimsOf(source);
      expect(cs).toHaveLength(2);
      expect(cs.every((c) => c.list)).toBe(true);
      // Word numbers a list item, so no typed number may remain in the text.
      expect(cs.map((c) => c.text)).toEqual([
        'A claim with a bee (2)',
        'The claim according to claim 1.',
      ]);
    }
  });

  it('puts a claim in the list even when it lands in a paragraph that was not one', () => {
    // The reported case. The claims section ends with a plain paragraph, so the
    // second claim was written into it and came out as typed text beside a
    // properly numbered first claim.
    const cs = claimsOf(section(num('A device (1).'), para('Dated: 2026.')));
    expect(cs.every((c) => c.list)).toBe(true);
    expect(cs.map((c) => c.text)).toEqual([
      'A claim with a bee (2)',
      'The claim according to claim 1.',
    ]);
  });

  it('leaves a lead-in line out of the list — it is not a claim', () => {
    // "What is claimed is:" opens with no claim number, so it must stay a plain
    // paragraph; joining the list would give it a claim number of its own.
    const cs = claimsOf(
      section(para('What is claimed is:'), num('A device (1).')),
      `What is claimed is:\n${NEW}`
    );
    expect(cs[0]).toEqual({ list: false, text: 'What is claimed is:' });
    expect(cs.slice(1).every((c) => c.list)).toBe(true);
  });

  it('keeps typed numbering typed, with no list numbering to double it', () => {
    const cs = claimsOf(section(para('1. A device (1).'), para('2. A device (1) of claim 1.')));
    expect(cs.some((c) => c.list)).toBe(false);
    expect(cs.map((c) => c.text)).toEqual([
      '1. A claim with a bee (2)',
      '2. The claim according to claim 1.',
    ]);
  });

  it('does not treat a numbered description line as a claim', () => {
    // The flag is per buffer: prose that opens with "1." is not a list item,
    // and the description must come back exactly as the user wrote it.
    const body = [
      para('DETAILED DESCRIPTION', { style: 'Heading1' }),
      para('1. The first embodiment uses a housing 12.'),
      para('CLAIMS', { style: 'Heading1' }),
      num('A device (1).'),
    ].join('');
    const { doc, split } = load(body);
    const edited = '1. The first embodiment uses a housing 14.';
    const out = writeDocx(doc, [
      { paras: split.descParas, text: edited },
      { paras: split.claimsParas, text: split.claims, claims: true },
    ]);
    const again = splitPatentDoc(readDocx(out));
    expect(again.description).toBe(edited);
    expect(documentXmlOf(out)).toContain('1. The first embodiment uses a housing 14.');
  });
});

describe('createDocx', () => {
  it('builds a readable document from plain text', () => {
    const bytes = createDocx([
      { text: 'The device 10 comprises a housing 12.' },
      { heading: 'Claims', text: '1. A device (10).' },
    ]);
    const paras = docxXmlToParagraphs(documentXmlOf(bytes)).map((p) => p.text);
    expect(paras).toContain('The device 10 comprises a housing 12.');
    expect(paras).toContain('Claims');
    expect(paras).toContain('1. A device (10).');
  });
  it('produces a file the reader accepts', () => {
    const doc = readDocx(createDocx([{ text: 'x 10' }]));
    expect(doc.paragraphs.map((p) => p.text)).toEqual(['x 10']);
  });
});

describe('alignLines size bail-out', () => {
  // Past MAX_LCS_CELLS the diff falls back to positional pairing rather than
  // allocating a multi-megabyte table. That degraded path had never run.
  // NB the edits must be scattered. alignLines trims the common head and tail
  // before measuring, so a single changed line leaves a 1x1 middle and takes the
  // ordinary LCS path however long the documents are.
  const scattered = (n) => {
    const a = Array.from({ length: n }, (_, i) => `line ${i}`);
    return [a, a.map((l, i) => (i % 500 === 0 ? l + ' edited' : l))];
  };

  it('still maps every line when the LCS table would be too large', () => {
    const [a, b] = scattered(2100);
    const { map } = alignLines(a, b);
    expect(map).toHaveLength(a.length);
    // Positional pairing: index i maps to index i.
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1);
    expect(map[a.length - 1]).toBe(a.length - 1);
  });

  it('takes the ordinary LCS path when the trimmed middle is small', () => {
    // Same document length, one edit — the trim keeps this off the degraded path.
    const a = Array.from({ length: 2100 }, (_, i) => `line ${i}`);
    const b = a.map((l, i) => (i === 5 ? 'line 5 edited' : l));
    const { map } = alignLines(a, b);
    expect(map[0]).toBe(0);
    expect(map[a.length - 1]).toBe(a.length - 1);
  });

  it('stays fast on the degraded path', () => {
    const [a, b] = scattered(2100);
    const t0 = performance.now();
    alignLines(a, b);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

// Each buffer plans its splices from its own paragraphs, so nothing else checks
// across buffers. The splitter CAN hand back overlapping regions, and two sets
// of edits over one range do not merge — they interleave into a file Word
// cannot open. This is the backstop that turns that into a loud failure.
describe('writeDocx refuses overlapping edits', () => {
  const body = [
    para('DETAILED DESCRIPTION', { style: 'Heading1' }),
    para('The device 10.'),
    para('A housing 12.'),
  ].join('');

  it('throws rather than interleaving two edits over the same paragraphs', () => {
    const { doc, split } = load(body);
    expect(() =>
      writeDocx(doc, [
        { paras: split.descParas, text: 'The device 14.\nA housing 12.' },
        { paras: split.descParas, text: 'The device 99.\nA housing 12.' },
      ])
    ).toThrow(/overlappingEdits/);
  });

  it('still writes when an insertion sits exactly where the next paragraph starts', () => {
    // An append is zero-width, so it touches its neighbours without overlapping
    // them — the guard must not mistake that for a collision.
    const { doc, split } = load(body);
    const xml = documentXmlOf(
      writeDocx(doc, [{ paras: split.descParas, text: 'The device 10.\nNEW 16.\nA housing 99.' }])
    );
    expect(docxXmlToParagraphs(xml).map((p) => p.text)).toEqual([
      'DETAILED DESCRIPTION',
      'The device 10.',
      'NEW 16.',
      'A housing 99.',
    ]);
  });
});
