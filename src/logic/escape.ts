// Escape the three characters that cannot appear literally in HTML/XML text
// content. Both consumers need exactly this and nothing more: the highlight
// backdrop (HTML) and the .docx writer (OOXML). Attribute values would also need
// quote escaping — neither caller emits untrusted text into an attribute.
//
// This lived as three character-identical copies (buildHtml, docx/write,
// docx/fixture) before being pulled together here.
export const escapeMarkup = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
