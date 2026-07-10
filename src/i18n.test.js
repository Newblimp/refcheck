import { describe, it, expect } from 'vitest';
import { T } from './i18n.js';

// A missing key renders as "undefined" silently, so parity between the two
// languages is enforced here instead of being discovered in the UI.
describe('i18n', () => {
  it('EN and DE define exactly the same keys', () => {
    expect(Object.keys(T.de).sort()).toEqual(Object.keys(T.en).sort());
  });

  it('every key has the same type (string vs function) in both languages', () => {
    for (const k of Object.keys(T.en)) {
      expect(typeof T.de[k], `key "${k}"`).toBe(typeof T.en[k]);
    }
  });
});
