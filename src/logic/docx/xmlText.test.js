import { describe, it, expect } from 'vitest';
import { stripInvalidXmlChars, xmlText } from './xmlText.js';

describe('stripInvalidXmlChars', () => {
  it('leaves ordinary text alone', () => {
    expect(stripInvalidXmlChars('Das Gehäuse 12 — a “housing”.')).toBe(
      'Das Gehäuse 12 — a “housing”.'
    );
  });

  it('drops the C0 controls XML 1.0 forbids', () => {
    // \x0C is the one that turns up in practice: a PDF page break pastes as one.
    expect(stripInvalidXmlChars('a\x00b\x07c\x0Bd\x0Ce\x1Ff')).toBe('abcdef');
  });

  it('keeps tab and newline', () => {
    expect(stripInvalidXmlChars('a\tb\nc')).toBe('a\tb\nc');
  });

  it('drops carriage returns, which a parser would turn into line breaks', () => {
    expect(stripInvalidXmlChars('a\r\nb\rc')).toBe('a\nbc');
  });

  it('drops the non-characters U+FFFE and U+FFFF', () => {
    expect(stripInvalidXmlChars('a\uFFFEb\uFFFFc')).toBe('abc');
  });

  it('keeps a well-formed surrogate pair', () => {
    expect(stripInvalidXmlChars('a\u{1F41D}b')).toBe('a\u{1F41D}b');
  });

  it('drops a lone surrogate left by a truncating copy', () => {
    expect(stripInvalidXmlChars('a\uD83Db')).toBe('ab');
    expect(stripInvalidXmlChars('a\uDC1Db')).toBe('ab');
    // A trailing high surrogate has nothing after it to pair with.
    expect(stripInvalidXmlChars('ab\uD83D')).toBe('ab');
  });

  it('keeps the pair when a lone surrogate sits next to a real one', () => {
    // Built by concatenation: written as adjacent literals the two escapes look
    // like one four-unit sequence to some parsers.
    const lone = String.fromCharCode(0xd83d);
    expect(stripInvalidXmlChars(lone + '\u{1F41D}')).toBe('\u{1F41D}');
  });
});

describe('xmlText', () => {
  it('escapes the three markup characters', () => {
    expect(xmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('strips first, then escapes', () => {
    expect(xmlText('a\x0C&b')).toBe('a&amp;b');
  });
});
