import type { Lang } from './logic/constants.ts';

// ── i18n: the help screen ───────────────────────────────────────────────────
// Split out of i18n.js, and the split is a loading decision rather than an
// organisational one: these strings are only ever read by HelpDialog, which is
// reached by an explicit click, so shipping them in the eager chunk put ~2.7 KB
// of text (both languages, as always) on the critical path for a screen most
// sessions never open. They ride in the dialog's own chunk instead — the same
// treatment the .docx pipeline and the bee get, precache obligation included.
//
// `helpBtn` deliberately stays in i18n.js: it labels the top bar's button, which
// renders on first paint. Everything here is inside the dialog.
//
// EN/DE key parity is asserted by i18n.test.js alongside T, because a help
// screen with an untranslated row is exactly as broken as a missing UI string.

const en = {
  helpTitle: 'RefSign Checker',
  helpGuideTitle: 'In short',
  helpGuide: [
    'Paste your text, or drop a .docx anywhere on the window.',
    'Description mode checks sign/term consistency; Claims mode also checks brackets, numbering, dependencies and antecedent basis.',
    'The right pane lists what it found. Click a card to jump to it in the text; click again for the next occurrence.',
    'Right-click a highlighted sign or term in the text to extend the term, write in a missing sign, or dismiss it.',
    'Dismiss anything that does not apply — dismissals are remembered.',
    'The left pane holds the reference list: the signs found in the text, and your own list to check against it — multi-word terms in that list are applied to the text automatically.',
    'Export writes your edits back into the imported .docx, changing only the paragraphs you touched.',
  ],
  helpKeysTitle: 'Keyboard',
  helpClose: 'Close',
  keyNextErr: 'Next error',
  keyPrevErr: 'Previous error',
  keyNextTerm: 'Next error for the same term',
  keyPrevTerm: 'Previous error for the same term',
  keySearch: 'Search the signs',
  keyMode: 'Switch Description / Claims',
  keyRefPane: 'Show or hide the reference list',
  keySignPane: 'Show or hide the reference signs',
  keyImport: 'Import a .docx',
  keyExport: 'Export a .docx',
  keyHelp: 'This screen',
  keyEsc: 'Close this screen or the context menu',
};

/** The help screen's strings. Derived from English, like T in i18n.ts. */
export type HelpStrings = typeof en;

const de: HelpStrings = {
  helpTitle: 'BezZeichen-Prüfer',
  helpGuideTitle: 'Kurz gefasst',
  helpGuide: [
    'Text einfügen oder eine .docx irgendwo ins Fenster ziehen.',
    'Der Beschreibungsmodus prüft Zeichen und Begriffe; der Anspruchsmodus zusätzlich Klammern, Nummerierung, Rückbezüge und Bezugsgrundlage.',
    'Der rechte Bereich listet die Funde. Ein Klick auf eine Karte springt in den Text, ein weiterer zum nächsten Vorkommen.',
    'Ein Rechtsklick auf ein hervorgehobenes Bezugszeichen oder einen Begriff im Text erweitert den Begriff, ergänzt ein fehlendes Bezugszeichen oder blendet den Fehler aus.',
    'Nicht Zutreffendes ausblenden — Ausblendungen werden gespeichert.',
    'Der linke Bereich zeigt die Bezugszeichenliste: die im Text gefundenen Zeichen und Ihre eigene Liste zum Abgleich — mehrteilige Begriffe aus dieser Liste werden im Text automatisch übernommen.',
    'Der Export schreibt Ihre Änderungen in die importierte .docx zurück und ändert nur die bearbeiteten Absätze.',
  ],
  helpKeysTitle: 'Tastatur',
  helpClose: 'Schließen',
  keyNextErr: 'Nächster Fehler',
  keyPrevErr: 'Vorheriger Fehler',
  keyNextTerm: 'Nächster Fehler zum selben Begriff',
  keyPrevTerm: 'Vorheriger Fehler zum selben Begriff',
  keySearch: 'Bezugszeichen durchsuchen',
  keyMode: 'Beschreibung / Ansprüche wechseln',
  keyRefPane: 'Bezugszeichenliste ein- oder ausblenden',
  keySignPane: 'Bezugszeichen ein- oder ausblenden',
  keyImport: '.docx importieren',
  keyExport: '.docx exportieren',
  keyHelp: 'Dieses Fenster',
  keyEsc: 'Dieses Fenster oder das Kontextmenü schließen',
};

export const HELP: Record<Lang, HelpStrings> = { en, de };
