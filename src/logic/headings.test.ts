import { describe, it, expect } from 'vitest';
import type { Lang } from './constants.ts';
import { matchHeading, normalizeHeading, SECTION_KINDS, HEADINGS } from './headings.ts';

const kindOf = (s: string) => matchHeading(s)?.kind ?? null;
const langOf = (s: string) => matchHeading(s)?.lang ?? null;

describe('normalizeHeading', () => {
  it('unifies whitespace, strips leading labels and trailing punctuation', () => {
    expect(normalizeHeading('  Detaillierte   Beschreibung  ')).toBe('detaillierte beschreibung');
    expect(normalizeHeading('III. Detailed Description')).toBe('detailed description');
    expect(normalizeHeading('B) Claims:')).toBe('claims');
    expect(normalizeHeading('2. Patentansprüche')).toBe('patentansprüche');
  });
  it('handles the non-breaking spaces Word emits', () => {
    expect(normalizeHeading('Patentansprüche')).toBe('patentansprüche');
  });
  it('does not eat the "I" of "I claim" (no delimiter, so no label)', () => {
    expect(normalizeHeading('I claim')).toBe('i claim');
    expect(kindOf('I claim')).toBe(SECTION_KINDS.CLAIMS);
  });
});

describe('matchHeading — claims', () => {
  it('matches the German claim headings', () => {
    for (const h of ['Patentansprüche', 'Ansprüche', 'Schutzansprüche', 'PATENTANSPRÜCHE']) {
      expect(kindOf(h)).toBe(SECTION_KINDS.CLAIMS);
      expect(langOf(h)).toBe('de');
    }
  });
  it('matches the English claim headings', () => {
    for (const h of [
      'Claims',
      'CLAIMS',
      'What is claimed is:',
      'We claim',
      'The invention claimed is',
      'Patent Claims',
      'PATENT CLAIMS',
      'patent claims',
      'Patent Claim',
    ]) {
      expect(kindOf(h)).toBe(SECTION_KINDS.CLAIMS);
      expect(langOf(h)).toBe('en');
    }
  });
  it('matches "Patent Claims" via the prefix fallback with trailing text', () => {
    expect(kindOf('Patent Claims of the Invention')).toBe(SECTION_KINDS.CLAIMS);
  });
});

describe('matchHeading — detailed description', () => {
  it('matches German variants', () => {
    for (const h of [
      'Detaillierte Beschreibung',
      'Detailierte Beschreibung',
      'Figurenbeschreibung',
      'Beschreibung der Ausführungsbeispiele',
      'Ausführungsbeispiele',
    ]) {
      expect(kindOf(h)).toBe(SECTION_KINDS.DETAILED_DESC);
      expect(langOf(h)).toBe('de');
    }
  });
  it('matches English variants', () => {
    for (const h of [
      'Detailed Description',
      'DETAILED DESCRIPTION OF THE INVENTION',
      'Description of Embodiments',
      'Detailed description of the preferred embodiments',
    ]) {
      expect(kindOf(h)).toBe(SECTION_KINDS.DETAILED_DESC);
      expect(langOf(h)).toBe('en');
    }
  });
});

describe('matchHeading — the BRIEF DESCRIPTION collision', () => {
  it('"Brief description of the drawings" is the figure listing', () => {
    expect(kindOf('BRIEF DESCRIPTION OF THE DRAWINGS')).toBe(SECTION_KINDS.FIGURE_LISTING);
  });
  it('"Description of the drawings" without BRIEF is the detailed description', () => {
    expect(kindOf('DESCRIPTION OF THE DRAWINGS')).toBe(SECTION_KINDS.DETAILED_DESC);
  });
  it('the prefix fallback keeps them apart too', () => {
    expect(kindOf('Brief description of the drawings of the invention')).toBe(
      SECTION_KINDS.FIGURE_LISTING
    );
    expect(kindOf('Kurzbeschreibung der Zeichnungen des Gerätes')).toBe(
      SECTION_KINDS.FIGURE_LISTING
    );
  });
});

describe('matchHeading — other kinds', () => {
  it('matches sign lists and abstracts in both languages', () => {
    expect(kindOf('Bezugszeichenliste')).toBe(SECTION_KINDS.SIGN_LIST);
    expect(kindOf('List of Reference Signs')).toBe(SECTION_KINDS.SIGN_LIST);
    expect(kindOf('Zusammenfassung')).toBe(SECTION_KINDS.ABSTRACT);
    expect(kindOf('ABSTRACT')).toBe(SECTION_KINDS.ABSTRACT);
  });
  it('matches "Summary" as an English abstract heading', () => {
    expect(kindOf('Summary')).toBe(SECTION_KINDS.ABSTRACT);
    expect(kindOf('SUMMARY')).toBe(SECTION_KINDS.ABSTRACT);
    expect(langOf('Summary')).toBe('en');
  });
});

describe('matchHeading — negatives (the whole-line requirement)', () => {
  it('does not match a sentence that merely mentions a heading word', () => {
    expect(
      matchHeading('Die Ansprüche 1 bis 4 betreffen eine Vorrichtung, die ein Gehäuse aufweist.')
    ).toBeNull();
    expect(
      matchHeading('The claims are directed to a device comprising a housing and a cover thereof.')
    ).toBeNull();
    expect(
      matchHeading(
        'Vorrichtung nach Anspruch 1, dadurch gekennzeichnet, dass das Gehäuse aus Alu ist.'
      )
    ).toBeNull();
  });
  it('does not match ordinary prose or empty lines', () => {
    expect(matchHeading('')).toBeNull();
    expect(matchHeading('   ')).toBeNull();
    expect(matchHeading('Die Vorrichtung 10 umfasst ein Gehäuse 12.')).toBeNull();
  });
  it('rejects a long line even when it starts with a heading phrase', () => {
    const long =
      'Detailed description of how the housing 12 is secured to the cover 14 by means of screws 18';
    expect(long.length).toBeGreaterThan(60);
    expect(matchHeading(long)).toBeNull();
  });
});

describe('HEADINGS dictionary', () => {
  it('every kind carries both languages as arrays of strings', () => {
    for (const kind of Object.values(SECTION_KINDS)) {
      const entry = HEADINGS[kind];
      expect(entry, kind).toBeTruthy();
      for (const lang of ['de', 'en']) {
        expect(Array.isArray(entry[lang as Lang]), `${kind}.${lang}`).toBe(true);
        expect(entry[lang as Lang].length).toBeGreaterThan(0);
        entry[lang as Lang].forEach((h: string) => expect(typeof h).toBe('string'));
      }
    }
  });
  it('every dictionary entry round-trips through matchHeading to its own kind', () => {
    for (const [kind, byLang] of Object.entries(HEADINGS)) {
      for (const list of Object.values(byLang)) {
        for (const h of list) expect(matchHeading(h)?.kind, h).toBe(kind);
      }
    }
  });
});
