import { describe, it, expect } from 'vitest';
import { must } from '../test/helpers.ts';
import type { ErrorSpan, KindSpan, SignSpan } from './errorSpans.ts';
import type { ArtError } from './extract.ts';
import type { ExtractResult } from './extract.ts';
import type { Mode } from './constants.ts';
import { readFileSync } from 'node:fs';
import { extractData } from './extract.ts';
import { eachErrorSpan, getAllErrors, errorGroup } from './errorSpans.ts';
import { HL } from './buildHtml.ts';
import { disKey } from './constants.ts';

const collect = (res: ExtractResult, mode: Mode, dis = new Set<string>()): ErrorSpan[] => {
  const out: ErrorSpan[] = [];
  eachErrorSpan(res, mode, dis, (sp) => out.push(sp));
  return out;
};

describe('eachErrorSpan', () => {
  it('reports consistent signs as ok and inconsistent ones as warn', () => {
    const res = extractData('The housing 12 is fixed. The casing 12 is fixed. The cover 14 is on.');
    const spans = collect(res, 'description');
    const sev = (sign: string) =>
      must(
        spans.find((s): s is SignSpan => s.kind === 'sign' && s.sign === sign),
        `sign ${sign}`
      ).sev;
    expect(sev('12')).toBe('warn');
    expect(sev('14')).toBe('ok');
  });

  it('emits a signTerm span alongside each warned sign, but not for ok signs', () => {
    const res = extractData('The housing 12 is fixed. The casing 12 is fixed. The cover 14 is on.');
    const spans = collect(res, 'description');
    const terms = spans.filter((s) => s.kind === 'signTerm');
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.every((s) => s.sign === '12')).toBe(true);
  });

  it('marks a dismissed sign dis rather than dropping it — the backdrop still greys it', () => {
    const res = extractData('The housing 12 is fixed. The casing 12 is fixed.');
    const dis = new Set([disKey.sign('12')]);
    const sign = must(
      collect(res, 'description', dis).find((s): s is SignSpan => s.kind === 'sign')
    );
    expect(sign.sev).toBe('dis');
    // ...while the navigator excludes it entirely.
    expect(getAllErrors(res, 'description', dis).some((e) => e.type === 'sign')).toBe(false);
  });

  it('omits dismissed article, bare, numbering and dependency errors', () => {
    const res = extractData('The housing 12 comprises a housing 12.');
    const withArt = collect(res, 'description').filter((s): s is KindSpan => s.kind === 'art');
    expect(withArt.length).toBeGreaterThan(0);
    const dis = new Set(withArt.map((s) => disKey.art((s.item as ArtError).termStem)));
    expect(collect(res, 'description', dis).filter((s) => s.kind === 'art')).toEqual([]);
  });

  it('covers every error category the extractor produces', () => {
    const claims = [
      '1. A device (10) comprising a housing (12).',
      '3. The device (10) according to claim 9, wherein the seal (14) is fitted.',
    ].join('\n');
    const res = extractData(claims, 'en', {}, true, true);
    const kinds = new Set(collect(res, 'claims').map((s) => s.kind));
    expect(kinds.has('sign')).toBe(true);
    expect(kinds.has('num')).toBe(true); // claim 3 where 2 was expected
    expect(kinds.has('dep')).toBe(true); // claim 3 refers to nonexistent claim 9
  });
});

describe('getAllErrors', () => {
  it('returns errors in document order', () => {
    const res = extractData('The housing 12 is fixed. The casing 12 is fixed.');
    const errs = getAllErrors(res, 'description', new Set());
    const starts = errs.map((e) => e.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('never returns a signTerm span — the sign itself is the navigation target', () => {
    const res = extractData('The housing 12 is fixed. The casing 12 is fixed.');
    const errs = getAllErrors(res, 'description', new Set());
    expect(errs.every((e) => (e.type as string) !== 'signTerm')).toBe(true);
  });

  it('excludes consistent signs', () => {
    // Introduced with an indefinite article, so there is no article error either.
    const res = extractData('A cover 14 is on. The cover 14 is fixed.');
    expect(getAllErrors(res, 'description', new Set())).toEqual([]);
  });

  it('excludes a cumulative back-reference and highlights it as the numbered term', () => {
    // "die Wellen 10, 20 und 30" after three numbered introductions: nothing to
    // step through, and the shortened occurrence still renders as an occurrence
    // of the term it refers back to (logic/cumulative.ts).
    const res = extractData(
      'Eine erste Welle 10, eine zweite Welle 20 und eine dritte Welle 30 sind vorgesehen.\n' +
        'Die Wellen 10, 20 und 30 sind koaxial.',
      'de'
    );
    expect(getAllErrors(res, 'description', new Set())).toEqual([]);
    const spans = collect(res, 'description').filter(
      (s): s is SignSpan => s.kind === 'sign' && s.sign === '10'
    );
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.sev === 'ok')).toBe(true);
    expect(new Set(spans.map((s) => s.term)).size).toBe(1); // both under the numbered term
  });

  it('carries each category under its historical property name', () => {
    const res = extractData('The housing 12 comprises a housing 12.');
    const errs = getAllErrors(res, 'description', new Set());
    const art = must(errs.find((e) => e.type === 'art'));
    expect(art.type === 'art' && art.ae).toBeDefined();
  });

  it('names the term every term-bearing error is about', () => {
    // "banana" is bare at the end; the sign is inconsistent (banana vs kiwi).
    const all = getAllErrors(
      extractData('The banana 10 is here. The kiwi 10 is odd. Another banana.'),
      'description',
      new Set()
    );
    const term = (type: string) => all.find((e) => e.type === type)?.term;
    expect(term('bare')).toBe('banana');
    expect(term('art')).toBe('banana');
    // A sign is named by the term of ITS occurrence, not by the sign's terms as
    // a whole — that is what makes the same-term jump skip the other spelling.
    expect(all.filter((e) => e.type === 'sign').map((e) => e.term)).toEqual(['banana', 'kiwi']);
  });

  it('leaves term null on errors that have none', () => {
    const res = extractData('1. A device (10).\n3. A device (10).', 'en', {}, true, true);
    const num = must(getAllErrors(res, 'claims', new Set()).find((e) => e.type === 'num'));
    expect(num).toBeDefined();
    expect(num.type !== 'sign' && num.term).toBeNull();
  });
});

describe('errorGroup', () => {
  const all = (text: string) => getAllErrors(extractData(text), 'description', new Set());

  it('puts every error about one term in the same group', () => {
    const errs = all('The banana 10 is here. A banana 10 is odd. Another banana.');
    const groups = new Set(errs.map(errorGroup));
    expect(errs.length).toBeGreaterThan(1);
    expect(groups.size).toBe(1);
  });

  it('separates the groups of two different terms', () => {
    // Article error on "banana", article error on "kiwi", bare "kiwi".
    const errs = all('The banana 10 is here. The kiwi 12 is here. Another kiwi.');
    expect(errs.map(errorGroup)).toEqual(['t:banana', 't:kiwi', 't:kiwi']);
  });

  it('groups term-less errors by category rather than into one bucket', () => {
    const res = extractData(
      '1. A device (10).\n3. A device (10) according to claim 9.',
      'en',
      {},
      true,
      true
    );
    const errs = getAllErrors(res, 'claims', new Set());
    const num = errs.find((e) => e.type === 'num');
    const dep = errs.find((e) => e.type === 'dep');
    expect(errorGroup(num)).toBe('k:num');
    expect(errorGroup(dep)).toBe('k:dep');
  });
});

describe('highlight classes', () => {
  it('every class the logic emits is defined in styles.css', () => {
    // The pure logic layer names stylesheet classes with nothing else linking
    // the two, so a rename in styles.css would silently stop highlighting.
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    for (const cls of Object.values(HL)) {
      expect(css, `styles.css is missing .${cls}`).toContain(`.${cls}`);
    }
  });
});
