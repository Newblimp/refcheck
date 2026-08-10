// ── EXPORT INTEGRITY ─────────────────────────────────────────────────────────
// The promise the export button makes is narrow and total: the file contains
// every change the user made, and nothing else. These tests are about that
// promise rather than about any one feature — the file must be well-formed XML,
// the parts nobody edited must be identical byte for byte, and the text must
// come back exactly as the buffer had it.
//
// Note that re-importing is NOT enough to catch the failures here. The reader is
// a tag scanner and reads badly nested markup happily; Word does not. So these
// check the markup as well as the round trip.

import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { writeDocx, documentXmlOf, planEdits, orderSplices } from './write.js';
import { readDocx, DocxError } from './read.js';
import { splitPatentDoc } from '../docSplit.js';
import { exportPatentDoc, importPatentDoc } from '../importDoc.js';
import { para, makeDocx, xmlFault, EN_BODY, DE_BODY } from './fixture.js';

const load = (body) => {
  const doc = readDocx(makeDocx(body));
  return { doc, split: splitPatentDoc(doc) };
};

const DESC = (...ps) => [para('DETAILED DESCRIPTION', { style: 'Heading1' }), ...ps].join('');

describe('xmlFault (the check the other tests lean on)', () => {
  it('passes well-formed markup', () => {
    expect(xmlFault('<a><b/><c>text &amp; more</c></a>')).toBe('');
    expect(xmlFault('<?xml version="1.0"?><a x="1"/>')).toBe('');
  });
  it('catches the shapes a bad splice produces', () => {
    expect(xmlFault('<a><b></a>')).not.toBe('');
    expect(xmlFault('<a>x</a>/w:t><b/>')).not.toBe('');
    expect(xmlFault('<a><b/>')).not.toBe('');
  });
});

// The bug: a line inserted after paragraph P lands at P's xmlEnd, which is the
// same offset as paragraph P+1's xmlStart. When P+1 was edited too, both
// splices sat at that offset; the insertion went in first, so the replacement's
// range then pointed at the freshly inserted paragraph and cut the next one in
// half. The result was not XML at all, and the inserted line was gone.
describe('an insertion and a replacement meeting at the same offset', () => {
  // Paragraph 2 spans two lines via <w:br/>, so the insertion after paragraph 1
  // anchors on paragraph 1's last line while paragraph 2 still changes.
  const body = DESC(
    para('alpha 10'),
    '<w:p><w:r><w:t xml:space="preserve">x 12</w:t><w:br/>' +
      '<w:t xml:space="preserve">y 14</w:t></w:r></w:p>'
  );

  it('produces well-formed XML and keeps both changes', () => {
    const { doc, split } = load(body);
    expect(split.description).toBe('alpha 10\nx 12\ny 14');
    const edited = 'alpha 10\nNEW 99\nx 12\ny 16';

    const out = writeDocx(doc, [{ paras: split.descParas, text: edited }]);
    expect(xmlFault(documentXmlOf(out))).toBe('');
    expect(splitPatentDoc(readDocx(out)).description).toBe(edited);
  });

  it('orders the replacement before the insertion at that offset', () => {
    const { split } = load(body);
    const edits = planEdits(split.descParas, 'alpha 10\nNEW 99\nx 12\ny 16');
    const ordered = orderSplices(edits, 1e6);
    const at = ordered.filter((s) => s.xmlStart === ordered[0].xmlStart);
    expect(at).toHaveLength(2);
    expect(at[0].append).toBeFalsy(); // the replacement first…
    expect(at[1].append).toBe(true); // …then the insertion in front of it
  });
});

describe('orderSplices', () => {
  it('sorts descending so earlier offsets stay valid', () => {
    const s = orderSplices(
      [
        { xmlStart: 10, xmlEnd: 20, xml: 'a' },
        { xmlStart: 40, xmlEnd: 50, xml: 'b' },
        { xmlStart: 25, xmlEnd: 25, xml: 'c', append: true },
      ],
      100
    );
    expect(s.map((x) => x.xmlStart)).toEqual([40, 25, 10]);
  });

  it('refuses overlapping ranges rather than mangling the document', () => {
    expect(() =>
      orderSplices(
        [
          { xmlStart: 10, xmlEnd: 30, xml: 'a' },
          { xmlStart: 20, xmlEnd: 40, xml: 'b' },
        ],
        100
      )
    ).toThrow(DocxError);
  });

  it('refuses an insertion that falls inside a replaced range', () => {
    expect(() =>
      orderSplices(
        [
          { xmlStart: 10, xmlEnd: 30, xml: 'a' },
          { xmlStart: 20, xmlEnd: 20, xml: 'b', append: true },
        ],
        100
      )
    ).toThrow(DocxError);
  });

  it('refuses a range outside the document', () => {
    expect(() => orderSplices([{ xmlStart: 0, xmlEnd: 500, xml: '' }], 100)).toThrow(DocxError);
    expect(() => orderSplices([{ xmlStart: -1, xmlEnd: 5, xml: '' }], 100)).toThrow(DocxError);
  });

  it('allows an insertion exactly at the boundary between two replacements', () => {
    expect(() =>
      orderSplices(
        [
          { xmlStart: 10, xmlEnd: 30, xml: 'a' },
          { xmlStart: 30, xmlEnd: 30, xml: 'b', append: true },
          { xmlStart: 30, xmlEnd: 50, xml: 'c' },
        ],
        100
      )
    ).not.toThrow();
  });
});

// A .docx whose claims heading comes BEFORE the description heading — an
// amendment sheet, or a response to an office action. The claims section used to
// run to the end of the document and swallow the description, so both buffers
// owned the same paragraphs and exporting wrote two texts over one range: the
// description vanished from the exported file without a word.
describe('sections that would otherwise overlap', () => {
  const body = [
    para('CLAIMS', { style: 'Heading1' }),
    para('1. A device (10).'),
    para('DETAILED DESCRIPTION', { style: 'Heading1' }),
    para('The device 10 has a housing 12.'),
  ].join('');

  it('splits into disjoint buffers', () => {
    const { split } = load(body);
    expect(split.claims).toBe('1. A device (10).');
    expect(split.description).toBe('The device 10 has a housing 12.');
  });

  it('exports both edits, keeping each section', () => {
    const { doc, split } = load(body);
    const out = writeDocx(doc, [
      { paras: split.descParas, text: 'The device 10 has a housing 14.' },
      { paras: split.claimsParas, text: '1. A device (14).', claims: true },
    ]);
    expect(xmlFault(documentXmlOf(out))).toBe('');
    const again = splitPatentDoc(readDocx(out));
    expect(again.claims).toBe('1. A device (14).');
    expect(again.description).toBe('The device 10 has a housing 14.');
  });
});

// Text pasted out of a PDF or an older word processor carries characters XML
// 1.0 simply cannot hold. Written through, they make a file Word refuses to
// open at all — and the drafter is told nothing beyond "unreadable content".
describe('characters that cannot go into XML', () => {
  it('drops a pasted form feed rather than emitting invalid XML', () => {
    const { doc, split } = load(DESC(para('alpha 10')));
    const out = writeDocx(doc, [{ paras: split.descParas, text: 'a page\x0Cbreak 10' }]);
    const xml = documentXmlOf(out);
    expect(xmlFault(xml)).toBe('');
    expect(xml).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    expect(splitPatentDoc(readDocx(out)).description).toBe('a pagebreak 10');
  });

  it('drops a lone surrogate left behind by a truncating copy', () => {
    const { doc, split } = load(DESC(para('alpha 10')));
    const out = writeDocx(doc, [
      { paras: split.descParas, text: 'half ' + String.fromCharCode(0xd83d) + ' emoji 10' },
    ]);
    expect(splitPatentDoc(readDocx(out)).description).toBe('half  emoji 10');
  });

  it('does not rewrite every paragraph when the buffer arrives with CRLF', () => {
    const { doc, split } = load(DESC(para('alpha 10'), para('beta 12')));
    // A paste from another tool can bring \r\n. Line for line the text is
    // unchanged, so nothing should be written at all.
    expect(planEdits(split.descParas, 'alpha 10\r\nbeta 12')).toEqual([]);
    const out = writeDocx(doc, [{ paras: split.descParas, text: 'alpha 10\r\nbeta 14' }]);
    expect(splitPatentDoc(readDocx(out)).description).toBe('alpha 10\nbeta 14');
  });
});

// read.js turns <w:noBreakHyphen/> into a character; write.js has to turn it
// back, or editing a paragraph silently swaps a non-breaking hyphen for a plain
// one — or, when it was simply dropped on the way in, deletes it outright.
describe('hyphens Word stores as elements', () => {
  it('round-trips through an edit', () => {
    const body = DESC(
      '<w:p><w:r><w:t>cross</w:t><w:noBreakHyphen/>' +
        '<w:t xml:space="preserve">section 10 of the device</w:t></w:r></w:p>'
    );
    const { doc, split } = load(body);
    expect(split.description).toBe('cross\u2011section 10 of the device');
    const edited = 'cross\u2011section 12 of the device';
    const out = writeDocx(doc, [{ paras: split.descParas, text: edited }]);
    expect(documentXmlOf(out)).toContain('<w:noBreakHyphen/>');
    expect(splitPatentDoc(readDocx(out)).description).toBe(edited);
  });
});

describe('everything the user did not touch survives', () => {
  it('keeps every other zip part byte for byte', () => {
    const { doc, split } = load(EN_BODY);
    const before = unzipSync(makeDocx(EN_BODY));
    const after = unzipSync(
      writeDocx(doc, [{ paras: split.descParas, text: `${split.description} Extra 20.` }])
    );
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    // Names alone were all the old test compared. Compare the bytes.
    for (const name of Object.keys(before)) {
      if (name === 'word/document.xml') continue;
      expect(Array.from(after[name]), name).toEqual(Array.from(before[name]));
    }
  });

  it('leaves document.xml identical outside the edited paragraph', () => {
    const { doc, split } = load(EN_BODY);
    const before = doc.documentXml;
    const after = documentXmlOf(
      writeDocx(doc, [
        {
          paras: split.descParas,
          text: split.description.replace('housing 12 is made', 'housing 14 is made'),
        },
        { paras: split.claimsParas, text: split.claims, claims: true },
      ])
    );
    // One paragraph differs; the head and the tail around it are untouched.
    const cut = before.indexOf('<w:p><w:r><w:t xml:space="preserve">The housing 12 is made');
    expect(cut).toBeGreaterThan(0);
    expect(after.slice(0, cut)).toBe(before.slice(0, cut));
    const tailFrom = before.indexOf('CLAIMS');
    expect(after.slice(after.indexOf('CLAIMS'))).toBe(before.slice(tailFrom));
  });

  it('writes nothing at all when neither buffer changed', () => {
    const { doc, split } = load(DE_BODY);
    const out = writeDocx(doc, [
      { paras: split.descParas, text: split.description },
      { paras: split.claimsParas, text: split.claims, claims: true },
    ]);
    expect(documentXmlOf(out)).toBe(doc.documentXml);
  });
});

// A section the source document does not have cannot be written into it. That
// is a legitimate limitation, but it must not be a silent one.
describe('exportPatentDoc verification', () => {
  const exportOf = (body, buffers) => exportPatentDoc(importPatentDoc(makeDocx(body)), buffers, {});

  it('reports a clean round trip as verified', () => {
    const imported = importPatentDoc(makeDocx(EN_BODY));
    const res = exportPatentDoc(
      imported,
      {
        description: imported.split.description.replace('housing 12', 'housing 14'),
        claims: imported.split.claims,
      },
      {}
    );
    expect(res.mode).toBe('roundTrip');
    expect(res.diffs).toEqual([]);
    expect(res.verified).toBe(true);
  });

  it('stays verified when a Word list renumbers the claims', () => {
    // The buffer says "3." where Word will render "2." — the numbering check's
    // whole purpose. That is not an export fault and must not be reported.
    const imported = importPatentDoc(makeDocx(DE_BODY));
    const res = exportPatentDoc(
      imported,
      {
        description: imported.split.description,
        claims: '1. Vorrichtung (10) mit einem Gehäuse (12).\n3. Vorrichtung (10) nach Anspruch 1.',
      },
      {}
    );
    expect(res.verified).toBe(true);
  });

  it('reports claims text that the source document has nowhere to put', () => {
    // No claims heading, so there are no claims paragraphs to splice into and
    // the claims buffer is silently dropped. The user has to be told.
    const res = exportOf(DESC(para('The device 10 has a housing 12.')), {
      description: 'The device 10 has a housing 12.',
      claims: '1. A device (10).',
    });
    expect(res.verified).toBe(false);
    expect(res.diffs[0]).toMatchObject({
      section: 'claims',
      line: 1,
      expected: '1. A device (10).',
      actual: '',
    });
  });

  it('names the section and line of the first difference', () => {
    const imported = importPatentDoc(makeDocx(EN_BODY));
    // Ask for something the writer cannot deliver by corrupting the provenance:
    // the paragraph offsets no longer point where the text is.
    imported.split.descParas = imported.split.descParas.map((p) => ({
      ...p,
      src: { ...p.src, xmlStart: p.src.xmlStart, xmlEnd: p.src.xmlStart },
    }));
    const res = exportPatentDoc(
      imported,
      { description: 'Completely different 20.', claims: imported.split.claims },
      {}
    );
    expect(res.verified).toBe(false);
    expect(res.diffs[0].section).toBe('description');
  });

  it('treats a fresh export as verified — there is no source to disagree with', () => {
    const res = exportPatentDoc(null, { description: 'The device 10.', claims: '' }, {});
    expect(res).toMatchObject({ mode: 'fresh', verified: true, diffs: [] });
  });
});
