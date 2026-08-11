import { describe, it, expect } from 'vitest';
import { T } from './i18n.ts';
import { HELP } from './helpText.ts';
import { BINDINGS } from './components/HelpDialog.tsx';

// A missing key renders as "undefined" silently, so parity between the two
// languages is enforced here instead of being discovered in the UI.
//
// HELP is checked by the same rules as T. It is a separate module only because
// it loads with the help dialog rather than on the critical path (see
// helpText.js); splitting it must not also split it out of this guard.
describe.each([
  ['T', T],
  ['HELP', HELP],
])('i18n: %s', (_name, table) => {
  it('EN and DE define exactly the same keys', () => {
    expect(Object.keys(table.de).sort()).toEqual(Object.keys(table.en).sort());
  });

  it('every key has the same type (string vs function) in both languages', () => {
    for (const k of Object.keys(table.en)) {
      expect(typeof table.de[k as keyof typeof table.de], `key "${k}"`).toBe(
        typeof table.en[k as keyof typeof table.en]
      );
    }
  });
});

describe('i18n: the help split', () => {
  it('keeps the help button label eager and the dialog strings lazy', () => {
    // The button paints on first load; everything inside the dialog does not.
    expect(T.en.helpBtn).toBeTruthy();
    expect((T.en as Record<string, unknown>).helpTitle).toBeUndefined();
    expect(HELP.en.helpTitle).toBeTruthy();
  });

  it('describes every keyboard binding the dialog renders, in both languages', () => {
    // BINDINGS names its descriptions by key; one that moved to the wrong side
    // of the split renders as an empty table cell rather than failing loudly.
    for (const b of BINDINGS) {
      for (const lang of ['en', 'de'] as const) {
        expect(HELP[lang][b.desc], `${lang}.${b.desc}`).toBeTruthy();
      }
    }
  });
});
