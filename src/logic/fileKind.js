// Filename classification, kept apart from importDoc.js on purpose.
//
// importDoc.js pulls in the .docx readers/writers and, through them, fflate —
// tens of kilobytes that most sessions never need, since plenty of users just
// paste text. App.jsx needs to classify a dropped file *before* deciding whether
// to load any of that, so this one tiny pure function lives on its own and stays
// in the main bundle while the rest is imported on demand.

const ACCEPTED = /\.(docx|docm)$/i;

/**
 * Classify a filename before we bother reading it.
 * @param {string} name
 * @returns {'ok'|'legacyDoc'|'unsupported'}
 */
export function fileKind(name) {
  const n = String(name || '');
  if (ACCEPTED.test(n)) return 'ok';
  if (/\.doc$/i.test(n)) return 'legacyDoc'; // binary OLE — not readable in-browser
  return 'unsupported';
}
