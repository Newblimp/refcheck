import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import { App } from './App.tsx';
import { makeDocx, para, DE_BODY } from '../logic/docx/fixture.ts';
import { readDocx } from '../logic/docx/read.ts';
import { splitPatentDoc } from '../logic/docSplit.ts';
import { must, q, maybe } from '../test/helpers.ts';

// jsdom's File has no arrayBuffer() in this version, so provide the bytes the
// import path actually reads.
const docxFile = (body: string, name = 'application.docx'): File => {
  const bytes = makeDocx(body);
  const file = new File([bytes as BlobPart], name);
  file.arrayBuffer = () =>
    Promise.resolve(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    );
  return file;
};

// DOM-level tests for the interactive layer (runs under jsdom via the
// *.ui.test.jsx glob in vite.config.js).

// The editor textarea and the highlight backdrop both contain the text, and a
// search input appears once signs exist — so target the editor by class and
// scope sidebar assertions to the overview pane.
const editor = () => q<HTMLTextAreaElement>(document, '.editor-ta');
const typeInto = (text: string) => fireEvent.change(editor(), { target: { value: text } });
const sidebar = (container: ParentNode) => within(q(container, '.ov-scroll'));
// The reference list moved out of the sidebar into its own pane, so its
// assertions need their own scope.
const refPane = (container: ParentNode) => within(q(container, '.ref-scroll'));

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
  // Applied to <html>, which no render tears down, so it would leak into the
  // next test the way data-theme's counterpart used to.
  document.documentElement.removeAttribute('data-crt');
  vi.clearAllMocks();
});

describe('App (interactive)', () => {
  it('populates the sidebar when text is entered', async () => {
    const { container } = render(<App />);
    expect(sidebar(container).getByText(/No reference signs detected/i)).toBeInTheDocument();
    typeInto('The housing 12 is large.');
    expect(await sidebar(container).findByText('12')).toBeInTheDocument();
    expect(sidebar(container).getByText('housing')).toBeInTheDocument();
    expect(sidebar(container).queryByText(/No reference signs detected/i)).not.toBeInTheDocument();
  });

  it('dismissing a warned sign removes its warning highlight', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    await waitFor(() => expect(maybe(container, '.badge.warn')).toBeTruthy());
    fireEvent.click(q(container, '.sign-card .dis-btn'));
    await waitFor(() => expect(maybe(container, '.badge.warn')).toBeFalsy());
  });

  it('collapses and re-expands a sidebar card section on header click', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    await waitFor(() => expect(maybe(container, '.sign-card')).toBeTruthy());
    const hdr = sidebar(container).getByText(/Inconsistencies/);
    expect(maybe(container, '.sidebar-section .sign-card')).toBeTruthy();
    fireEvent.click(hdr);
    expect(maybe(container, '.sidebar-section .sign-card')).toBeFalsy();
    fireEvent.click(hdr);
    expect(maybe(container, '.sidebar-section .sign-card')).toBeTruthy();
  });

  it('navigation buttons cycle through errors', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    await waitFor(() => expect(maybe(container, '.nav-lbl')).toBeTruthy());
    expect(q(container, '.nav-lbl').textContent).toMatch(/^1 \//);
    const [, next] = container.querySelectorAll('.nav-btn');
    fireEvent.click(next);
    expect(q(container, '.nav-lbl').textContent).toMatch(/^2 \//);
  });

  it('clicking a sign card cycles through its occurrences, then unfocuses', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    const card = await waitFor(() => {
      const c = maybe(container, '.sign-card');
      if (!c) throw new Error('no sign card yet');
      return c;
    });
    const ed = editor();
    const first = ed.value.indexOf('12');
    const second = ed.value.indexOf('12', first + 1);
    expect(second).toBeGreaterThan(first);

    fireEvent.click(card); // 1st click → first occurrence
    expect(ed.selectionStart).toBe(first);
    fireEvent.click(card); // 2nd click → next occurrence
    expect(ed.selectionStart).toBe(second);
    fireEvent.click(card); // past the last → unfocus
    expect(maybe(container, '.sign-card.focused')).toBeFalsy();
    fireEvent.click(card); // cycle restarts at the first
    expect(ed.selectionStart).toBe(first);
  });

  it('copies the reference list to the clipboard', async () => {
    const { container } = render(<App />);
    typeInto('The device 10 has a housing 12.');
    await waitFor(() => expect(maybe(container, '.reflist-section')).toBeTruthy());
    fireEvent.click(q(container, '.reflist-hdr')); // expand
    fireEvent.click(q(container, '.reflist-section .restore-btn')); // copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('10\tdevice\n12\thousing');
    expect(await within(q(container, '.reflist-section')).findByText('Copied')).toBeInTheDocument();
  });

  it('imports a dropped .docx into both buffers and sets the language', async () => {
    const { container } = render(<App />);
    const file = docxFile(DE_BODY);
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [file] } });

    await waitFor(() =>
      expect(editor().value).toContain('Die Vorrichtung 10 umfasst ein Gehäuse 12.')
    );
    // Only the detailed description — not the abstract, figure listing or sign list.
    expect(editor().value).not.toContain('Die Erfindung betrifft');
    expect(editor().value).not.toContain('Fig. 1 zeigt');
    expect(editor().value).not.toContain('10 Vorrichtung');
    // Language switched to German off the "Patentansprüche" heading.
    await waitFor(() => expect(q(container, '.lang-toggle button.active').textContent).toBe('DE'));
    // Warnings render in the language the import just switched TO, not the one
    // that was active when the file was dropped.
    expect(await screen.findByText(/automatisch nummerierte Ansprüche/)).toBeInTheDocument();
    // Claims landed in the other buffer, with auto-numbering reconstructed.
    fireEvent.click(screen.getByText('Ansprüche'));
    expect(editor().value).toMatch(/^1\. Vorrichtung \(10\)/);
  });

  it('undo restores the buffers that the import replaced', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    typeInto('The housing 12 is large.');
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [docxFile(DE_BODY)] } });
    await waitFor(() => expect(editor().value).toContain('Gehäuse 12'));

    fireEvent.click(await screen.findByText(/Rückgängig|Undo/));
    await waitFor(() => expect(editor().value).toBe('The housing 12 is large.'));
  });

  it('exports the edited document without complaint when it verifies', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [docxFile(DE_BODY)] } });
    await waitFor(() => expect(editor().value).toContain('Gehäuse 12'));
    typeInto(editor().value.replace('Gehäuse 12 besteht', 'Gehäuse 14 besteht'));

    fireEvent.click(screen.getByText('.docx exportieren'));
    await waitFor(() => expect(globalThis.__lastExportedBlob).toBeTruthy());
    const out = new Uint8Array(await must(globalThis.__lastExportedBlob).arrayBuffer());
    expect(splitPatentDoc(readDocx(out)).description).toContain('Gehäuse 14 besteht');
    // A verified export says nothing; the banner still shows the import result.
    expect(screen.queryByText(/erneuten Einlesen|reading it back/)).toBeNull();
  });

  it('warns when the exported file does not reproduce the buffers', async () => {
    // A document with no claims section has nowhere to put claims text, so the
    // claims buffer is silently dropped from the file. The user must be told.
    const descOnly = para('Detaillierte Beschreibung', { style: 'Heading1' }) + para('Gehäuse 12.');
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [docxFile(descOnly)] } });
    await waitFor(() => expect(editor().value).toContain('Gehäuse 12.'));

    fireEvent.click(screen.getByText('Ansprüche'));
    typeInto('1. Vorrichtung (10).');
    fireEvent.click(screen.getByText('.docx exportieren'));

    expect(await screen.findByText(/erneuten Einlesen/)).toBeInTheDocument();
    expect(await screen.findByText(/Ansprüche, Zeile 1/)).toBeInTheDocument();
  });

  it('reports a clear error for a legacy .doc instead of importing garbage', async () => {
    render(<App />);
    const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'old.doc');
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(await screen.findByText(/Legacy \.doc/)).toBeInTheDocument();
    expect(editor().value).toBe('');
  });

  it('typing "bee" sends a bee across the screen, which shows its bubble on hover', async () => {
    const { container } = render(<App />);
    expect(maybe(container, '.bee-wrap')).toBeFalsy();

    typeInto('The bee 12 is large.');
    const bee = await waitFor(() => {
      const el = maybe(container, '.bee-wrap');
      expect(el).toBeTruthy();
      return must(el, '.bee-wrap');
    });
    // The bubble carries the joke, and is hidden until the pointer is near.
    const bubble = q(bee, '.bee-bubble');
    expect(bubble.textContent).toBe("§ 961 BGB! I'm free!!");
    expect(bubble.className).not.toContain('show');
    // The bee must never intercept pointer events from the editor.
    expect(bee.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the German bubble text when the UI is German', async () => {
    localStorage.setItem('rsc_lang', 'de');
    const { container } = render(<App />);
    typeInto('Die Biene bee 12.');
    await waitFor(() => expect(maybe(container, '.bee-bubble')).toBeTruthy());
    expect(q(container, '.bee-bubble').textContent).toBe('§ 961 BGB! Ich bin frei!!');
  });

  it('keeps the bee flying while the user carries on typing', async () => {
    // Regression: onDone used to be a fresh closure each render, so every
    // keystroke tore down the animation effect and respawned the bee just
    // off-screen — it never flew in.
    const { container } = render(<App />);
    typeInto('a bee ');
    await waitFor(() => expect(maybe(container, '.bee-wrap')).toBeTruthy());
    const first = maybe(container, '.bee-wrap');
    typeInto('a bee and the housing 12 keeps being typed');
    typeInto('a bee and the housing 12 keeps being typed further');
    // Same element instance — the flight was never restarted.
    expect(maybe(container, '.bee-wrap')).toBe(first);
  });

  it('still summons a bee on an explicit request under prefers-reduced-motion', async () => {
    // The setting suppresses the RANDOM appearances, but typing "bee" is an
    // explicit by-name request; silently doing nothing just looks broken.
    const mm = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      media: query,
      matches: /prefers-reduced-motion/.test(query),
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      const { container } = render(<App />);
      typeInto('This should spawn a bee');
      await waitFor(() => expect(maybe(container, '.bee-wrap')).toBeTruthy());
    } finally {
      window.matchMedia = mm;
    }
  });

  it('typing "bee" twice summons two bees', async () => {
    const { container } = render(<App />);
    typeInto('a bee');
    await waitFor(() => expect(container.querySelectorAll('.bee-wrap')).toHaveLength(1));
    typeInto('a bee and another bee');
    await waitFor(() => expect(container.querySelectorAll('.bee-wrap')).toHaveLength(2));
  });

  it('typing "Biene" summons a bee when German is active', async () => {
    localStorage.setItem('rsc_lang', 'de');
    const { container } = render(<App />);
    typeInto('Eine Biene sitzt auf dem Gehäuse 12.');
    await waitFor(() => expect(maybe(container, '.bee-wrap')).toBeTruthy());
    expect(q(container, '.bee-bubble').textContent).toBe('§ 961 BGB! Ich bin frei!!');
  });

  it('"Biene" does nothing in English, and switching language does not summon one', async () => {
    const { container } = render(<App />);
    typeInto('Eine Biene sitzt auf dem Gehäuse 12.');
    await waitFor(() => expect(sidebar(container).getByText('12')).toBeInTheDocument());
    expect(maybe(container, '.bee-wrap')).toBeFalsy();
    // Flipping to German re-baselines rather than reading the jump as a request.
    fireEvent.click(screen.getByText('DE'));
    await waitFor(() => expect(screen.getByText('Ansprüche')).toBeInTheDocument());
    expect(maybe(container, '.bee-wrap')).toBeFalsy();
  });

  it('does not summon a bee just for restoring a buffer that already says "bee"', async () => {
    localStorage.setItem('rsc_desc', 'The bee 12 is large.');
    const { container } = render(<App />);
    await waitFor(() => expect(editor().value).toContain('bee'));
    expect(maybe(container, '.bee-wrap')).toBeFalsy();
  });

  it('restores persisted text on load and clears it on reset', async () => {
    localStorage.setItem('rsc_desc', 'The housing 12 is large.');
    const { container } = render(<App />);
    expect(editor().value).toBe('The housing 12 is large.');
    expect(await sidebar(container).findByText('12')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(q(container, '.reset-btn'));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(editor().value).toBe(''));
  });

  it('switching modes preserves both buffers and shows the claims note', async () => {
    render(<App />);
    typeInto('The housing 12 is large.');
    fireEvent.click(screen.getByText('Claims'));
    expect(editor().value).toBe('');
    typeInto('1. A device (10).');
    expect(screen.getByText(/signs must be in/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Description'));
    expect(editor().value).toBe('The housing 12 is large.');
    fireEvent.click(screen.getByText('Claims'));
    expect(editor().value).toBe('1. A device (10).');
  });

  it('shows the cross-reference section when both buffers have content', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided.');
    fireEvent.click(screen.getByText('Claims'));
    typeInto('1. A device (10) with a housing (12).');
    // Sign 10 exists only in the claims buffer → "in claims, not in description".
    expect(
      await sidebar(container).findByText(/in claims, not in description/)
    ).toBeInTheDocument();
  });

  it('flags a bad claim dependency and dismisses it from its card', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('Claims'));
    typeInto('1. A device (10) according to claim 3.');
    expect(await sidebar(container).findByText(/nonexistent claim 3/)).toBeInTheDocument();
    const card = must(
      sidebar(container)
        .getByText(/nonexistent claim 3/)
        .closest('.err-card'),
      '.err-card'
    );
    fireEvent.click(q(card, '.dis-btn'));
    await waitFor(() =>
      expect(sidebar(container).queryByText(/nonexistent claim 3/)).not.toBeInTheDocument()
    );
  });

  it('extends a term via the context menu', async () => {
    const { container } = render(<App />);
    typeInto('The control unit 12 is here.');
    await sidebar(container).findByText('12');
    const ed = editor();
    const pos = ed.value.indexOf('12');
    ed.setSelectionRange(pos, pos);
    fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
    const extend = await screen.findByText(/Extend term \(1 word\)/);
    fireEvent.click(extend);
    // mwo now maps the "unit" stem to +1 word → the chip shows the 2-word term.
    expect(await sidebar(container).findByText('control unit')).toBeInTheDocument();
    expect(JSON.parse(must(localStorage.getItem('rsc_mwo')))).toHaveProperty('unit', 1);
  });

  // A mistyped sign reads as a term-to-sign inconsistency. The term's own
  // frequencies say which occurrence is the slip, so the menu offers to correct
  // it in place. See logic/signFix.ts.
  describe('correcting a mistyped sign from the context menu', () => {
    const TYPO = 'Der Begriff 1 ist da.\nDer Begriff 2 ist da.\nDer Begriff 1 ist da.';
    const openOnSecond = async (container: ParentNode) => {
      fireEvent.click(screen.getByText('DE'));
      typeInto(TYPO);
      await sidebar(container).findByText('2');
      const ed = editor();
      const pos = ed.value.indexOf('Begriff 2') + 2; // on the term, as a reader would
      ed.setSelectionRange(pos, pos);
      fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
      return screen.findByRole('menu');
    };

    it('rewrites the sign and clears the inconsistency', async () => {
      const { container } = render(<App />);
      const menu = await openOnSecond(container);
      fireEvent.click(within(menu).getByText(/Bezugszeichen 2 → 1 korrigieren/));
      await waitFor(() =>
        expect(editor().value).toBe(
          'Der Begriff 1 ist da.\nDer Begriff 1 ist da.\nDer Begriff 1 ist da.'
        )
      );
      // Sign 2 is gone from the document, and 1 is no longer inconsistent.
      await waitFor(() => expect(sidebar(container).queryByText('2')).not.toBeInTheDocument());
      // The caret is left just after the sign it rewrote — the one on line 2,
      // not the first "Begriff 1" in the document.
      const v = editor().value;
      const corrected = v.indexOf('Begriff 1', v.indexOf('\n'));
      expect(editor().selectionStart).toBe(corrected + 'Begriff 1'.length);
    });

    it('does not offer it on the occurrences that agree', async () => {
      const { container } = render(<App />);
      fireEvent.click(screen.getByText('DE'));
      typeInto(TYPO);
      await sidebar(container).findByText('2');
      const ed = editor();
      const pos = ed.value.indexOf('Begriff 1') + 2;
      ed.setSelectionRange(pos, pos);
      fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
      const menu = await screen.findByRole('menu');
      expect(within(menu).queryByText(/korrigieren/)).not.toBeInTheDocument();
    });
  });

  // A term written without its sign is highlighted, but until now the editor's
  // context menu only knew about signs and articles — so the very occurrence the
  // tool complains about was the one that could not be acted on.
  describe('bare-term context menu', () => {
    const BARE = 'A bendy banana 10 is arranged next to another bendy banana.';
    // Right-click the second (sign-less) "banana".
    const openOnBareTerm = async (container: ParentNode) => {
      typeInto(BARE);
      await sidebar(container).findByText(/missing sign/);
      const ed = editor();
      const pos = ed.value.lastIndexOf('banana') + 2;
      ed.setSelectionRange(pos, pos);
      fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
      return screen.findByRole('menu');
    };

    it('offers extend, insert-sign and dismiss on a term with no sign', async () => {
      const { container } = render(<App />);
      const menu = await openOnBareTerm(container);
      expect(within(menu).getByText(/Extend term \(1 word\)/)).toBeInTheDocument();
      expect(within(menu).getByText(/Insert reference sign 10 here/)).toBeInTheDocument();
      expect(
        within(menu).getByText(/Dismiss missing-sign errors for "banana"/)
      ).toBeInTheDocument();
    });

    it('writes the sign into the text, clearing the error', async () => {
      const { container } = render(<App />);
      const menu = await openOnBareTerm(container);
      fireEvent.click(within(menu).getByText(/Insert reference sign 10 here/));
      await waitFor(() =>
        expect(editor().value).toBe(
          'A bendy banana 10 is arranged next to another bendy banana 10.'
        )
      );
      await waitFor(() =>
        expect(sidebar(container).queryByText(/missing sign/)).not.toBeInTheDocument()
      );
      // The caret is left after the inserted sign, ready to type on.
      expect(editor().selectionStart).toBe(
        editor().value.indexOf('banana 10.') + 'banana 10'.length
      );
    });

    it('brackets the inserted sign in claims mode', async () => {
      const { container } = render(<App />);
      fireEvent.click(screen.getByText('Claims'));
      typeInto('1. A banana (10) arranged next to another banana.');
      await sidebar(container).findByText(/missing sign/);
      const ed = editor();
      const pos = ed.value.lastIndexOf('banana') + 2;
      ed.setSelectionRange(pos, pos);
      fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
      const menu = await screen.findByRole('menu');
      fireEvent.click(within(menu).getByText(/Insert reference sign 10 here/));
      await waitFor(() =>
        expect(editor().value).toBe('1. A banana (10) arranged next to another banana (10).')
      );
    });

    it('does not offer a sign when the term has more than one', async () => {
      const { container } = render(<App />);
      typeInto('A banana 10 and a banana 12 are here. Another banana.');
      await sidebar(container).findByText(/missing sign/);
      const ed = editor();
      const pos = ed.value.lastIndexOf('banana') + 2;
      ed.setSelectionRange(pos, pos);
      fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
      const menu = await screen.findByRole('menu');
      // Which of 10 and 12 belongs here is the drafter's call, not the tool's.
      expect(within(menu).queryByText(/Insert reference sign/)).not.toBeInTheDocument();
      expect(within(menu).getByText(/Dismiss missing-sign errors/)).toBeInTheDocument();
    });

    it('dismisses the error from the menu', async () => {
      const { container } = render(<App />);
      const menu = await openOnBareTerm(container);
      fireEvent.click(within(menu).getByText(/Dismiss missing-sign errors for "banana"/));
      await waitFor(() =>
        expect(sidebar(container).queryByText(/missing sign/)).not.toBeInTheDocument()
      );
    });

    it('extends the term from a sign-less occurrence', async () => {
      const { container } = render(<App />);
      const menu = await openOnBareTerm(container);
      fireEvent.click(within(menu).getByText(/Extend term \(1 word\)/));
      expect(await sidebar(container).findByText('bendy banana')).toBeInTheDocument();
      await waitFor(() =>
        expect(JSON.parse(must(localStorage.getItem('rsc_mwo')))).toHaveProperty('banana', 1)
      );
    });
  });

  it('language toggle switches labels and persists', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('DE'));
    expect(screen.getByText('Beschreibung')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('rsc_lang')).toBe('de'));
  });

  it('restores a persisted language on load', () => {
    localStorage.setItem('rsc_lang', 'de');
    render(<App />);
    expect(screen.getByText('Beschreibung')).toBeInTheDocument();
  });

  it('theme toggle applies data-theme and persists', async () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('Light'));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    expect(localStorage.getItem('rsc_theme')).toBe('light');
  });

  it('CRT filter toggles data-crt on and off, and persists', async () => {
    render(<App />);
    const on = screen.getByLabelText('Switch on the CRT screen filter');
    expect(on).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(on);
    // Asynchronous on purpose: the stylesheet is a lazily fetched asset, and
    // the attribute is what its rules hang off, so it waits for the import.
    await waitFor(() => expect(document.documentElement.getAttribute('data-crt')).toBe('on'));
    expect(localStorage.getItem('rsc_crt')).toBe('on');

    fireEvent.click(screen.getByLabelText('Switch off the CRT screen filter'));
    await waitFor(() => expect(document.documentElement.hasAttribute('data-crt')).toBe(false));
    expect(localStorage.getItem('rsc_crt')).toBe('off');
  });

  it('restores the CRT filter on load', async () => {
    localStorage.setItem('rsc_crt', 'on');
    render(<App />);
    await waitFor(() => expect(document.documentElement.getAttribute('data-crt')).toBe('on'));
    expect(screen.getByLabelText('Switch off the CRT screen filter')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('restores persisted dismissals on load', async () => {
    localStorage.setItem('rsc_desc', 'The housing 12 is the casing 12.');
    localStorage.setItem('rsc_dis', JSON.stringify(['s:12']));
    const { container } = render(<App />);
    // The warned sign is already dismissed → dim badge, no warn badge.
    await waitFor(() => expect(maybe(container, '.badge.dim')).toBeTruthy());
    expect(maybe(container, '.badge.warn')).toBeFalsy();
  });
});

describe('App (keyboard and accessibility)', () => {
  const CONFLICT = 'The housing 12 is fixed. The casing 12 is fixed. A cover 14 is on.';

  it('steps through errors with Ctrl+] and Ctrl+[', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const label = () => maybe(container, '.nav-lbl')?.textContent;
    await waitFor(() => expect(label()).toBeTruthy());
    const first = label();

    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    await waitFor(() => expect(label()).not.toBe(first));
    const second = label();

    fireEvent.keyDown(window, { key: '[', ctrlKey: true });
    await waitFor(() => expect(label()).toBe(first));
    expect(second).not.toBe(first);
  });

  it('the error-nav buttons have accessible names', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    // These were SVG-only buttons with no name at all.
    expect(screen.getByRole('button', { name: /previous error/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next error/i })).toBeInTheDocument();
  });

  it('error cards are reachable and activatable by keyboard', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const card = q(container, '.sign-card');
    // Was a plain <div onClick> — no role, no tab stop, no key handler.
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    await waitFor(() => expect(card.className).toMatch(/focused/));
  });

  it('activates a card with Space as well as Enter', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const card = q(container, '.sign-card');
    fireEvent.keyDown(card, { key: ' ' });
    await waitFor(() => expect(card.className).toMatch(/focused/));
  });

  it('collapsible section headers expose their expanded state', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const header = q(container, '.sec-lbl-toggle');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    await waitFor(() => expect(header).toHaveAttribute('aria-expanded', 'false'));
  });

  it('"/" focuses the sign filter, but not while typing in the editor', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const search = maybe(container, '.search-in');

    // Fired at the editor: must be ignored, or the app is unusable.
    fireEvent.keyDown(editor(), { key: '/', target: editor() });
    expect(document.activeElement).not.toBe(search);

    fireEvent.keyDown(document.body, { key: '/' });
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('keeps <html lang> in step with the language toggle', async () => {
    render(<App />);
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByRole('button', { name: 'DE' }));
    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
  });

  it('marks the active language toggle with aria-pressed', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'DE' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes main and both complementary landmarks', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    // One aside per side pane, each named — an unnamed pair would be
    // indistinguishable to a screen reader jumping between landmarks.
    expect(screen.getByRole('complementary', { name: /reference signs/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /reference list/i })).toBeInTheDocument();
  });

  it('gives the editor an accessible name', () => {
    render(<App />);
    expect(screen.getByRole('textbox', { name: /patent text/i })).toBeInTheDocument();
  });
});

describe('App (reference-list check and claim statistics)', () => {
  const refListInput = (container: ParentNode) => q<HTMLTextAreaElement>(container, '.rlc-in');

  it('reports a reference list that matches the text', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided. The housing 12 holds a cover 14.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), {
      target: { value: '12 housing\n14 cover' },
    });
    expect(await refPane(container).findByText(/2 entries match the text/)).toBeInTheDocument();
  });

  it('flags a term that differs between the list and the text', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided. The housing 12 holds a cover 14.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), {
      target: { value: '12 casing\n14 cover' },
    });
    expect(
      await refPane(container).findByText(/list: "casing".*text: "housing"/)
    ).toBeInTheDocument();
  });

  it('flags a sign listed but never used, and one used but not listed', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided. The housing 12 holds a cover 14.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), {
      target: { value: '12 housing\n99 flywheel' },
    });
    expect(await refPane(container).findByText(/never used in the text/)).toBeInTheDocument();
    expect(refPane(container).getByText(/not listed/)).toBeInTheDocument();
  });

  it('persists the reference list across a remount', async () => {
    const { container, unmount } = render(<App />);
    typeInto('A housing 12 is provided.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), { target: { value: '12 housing' } });
    // The text buffer write is debounced; the sidebar only renders its sections
    // once the restored buffer produces signs, so wait for both to land.
    await waitFor(() => expect(localStorage.getItem('rsc_reflist')).toBe('12 housing'));
    await waitFor(() => expect(localStorage.getItem('rsc_desc')).toBeTruthy());
    unmount();
    const again = render(<App />);
    expect(await again.findByDisplayValue('12 housing')).toBeInTheDocument();
  });

  it('fills the reference list from an imported .docx Bezugszeichenliste', async () => {
    const { container } = render(<App />);
    const file = docxFile(DE_BODY);
    await waitFor(() => expect(maybe(document, '.editor-ta')).toBeInTheDocument());
    const dt = { types: ['Files'], files: [file] };
    fireEvent(
      window,
      Object.assign(new Event('dragenter', { bubbles: true }), { dataTransfer: dt })
    );
    fireEvent(window, Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: dt }));
    await waitFor(() => expect(refListInput(container).value).toBe('10 Vorrichtung\n12 Gehäuse'));
  });

  // The list already says which terms are multi-word, so the text scan reads
  // them from it instead of leaving every one to be extended by hand.
  describe('multi-word terms taken from the list', () => {
    const MW_BODY = [
      para('DETAILED DESCRIPTION', { style: 'Heading1' }),
      para('The device 10 comprises a control unit 30.'),
      para('The control unit 30 is grey.'),
      para('CLAIMS', { style: 'Heading1' }),
      para('1. A device (10) comprising a control unit (30).'),
      para('REFERENCE SIGNS', { style: 'Heading1' }),
      para('10 device'),
      para('30 control unit'),
    ].join('');

    it('extends a term in the text from a pasted list, and says so', async () => {
      const { container } = render(<App />);
      typeInto('The device 10 comprises a control unit 30. The control unit 30 is grey.');
      await sidebar(container).findByText('30');
      expect(sidebar(container).getByText('unit')).toBeInTheDocument();

      fireEvent.change(refListInput(container), {
        target: { value: '10 device\n30 control unit' },
      });
      expect(await sidebar(container).findByText('control unit')).toBeInTheDocument();
      // Reported as information, and the list now agrees with the text.
      expect(
        await refPane(container).findByText(/1 multi-word term taken from the list/)
      ).toBeInTheDocument();
      expect(refPane(container).getByText(/2 entries match the text/)).toBeInTheDocument();
    });

    it('lets the drafter reduce an auto-extended term back again', async () => {
      const { container } = render(<App />);
      typeInto('The device 10 comprises a control unit 30.');
      await sidebar(container).findByText('30');
      fireEvent.change(refListInput(container), { target: { value: '30 control unit' } });
      await sidebar(container).findByText('control unit');

      const ed = editor();
      const pos = ed.value.indexOf('30');
      ed.setSelectionRange(pos, pos);
      fireEvent.contextMenu(ed, { clientX: 50, clientY: 50 });
      // The menu counts the term as it stands, not as mwo left it.
      expect(await screen.findByText(/Extend term \(2 words\)/)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Reduce term'));

      expect(await sidebar(container).findByText('unit')).toBeInTheDocument();
      expect(sidebar(container).queryByText('control unit')).not.toBeInTheDocument();
      // An explicit 0, so the list cannot silently put the word back.
      await waitFor(() => expect(JSON.parse(must(localStorage.getItem('rsc_mwo'))).unit).toBe(0));
      // …and the reduction is what the panel now reports.
      await waitFor(() =>
        expect(refPane(container).queryByText(/multi-word term/)).not.toBeInTheDocument()
      );
    });

    it('extends terms in both buffers from an imported .docx sign list', async () => {
      const { container } = render(<App />);
      const dt = { types: ['Files'], files: [docxFile(MW_BODY)] };
      fireEvent.drop(window, { dataTransfer: dt });

      await waitFor(() => expect(refListInput(container).value).toContain('30 control unit'));
      expect(await sidebar(container).findByText('control unit')).toBeInTheDocument();
      // Claims mode reads the same list — it describes the whole application.
      fireEvent.click(screen.getByText('Claims'));
      expect(await sidebar(container).findByText('control unit')).toBeInTheDocument();
    });
  });

  it('shows claim-set statistics in claims mode', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('Claims'));
    typeInto(
      [
        '1. A device (10) comprising a housing (12).',
        '2. The device (10) of claim 1, wherein the housing (12) is metal.',
        '3. The device (10) according to claim 1 or 2, further comprising a cover (14).',
      ].join('\n')
    );
    await waitFor(() => expect(maybe(container, '.cs-body')).toBeInTheDocument());
    const stats = within(q(container, '.cs-body'));
    expect(stats.getByText('Count').previousSibling).toHaveTextContent('3');
    expect(stats.getByText(/multiple dependency: claim 3/)).toBeInTheDocument();
  });

  it('does not show claim statistics in description mode', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided.');
    await sidebar(container).findByText('12');
    expect(maybe(container, '.cs-body')).not.toBeInTheDocument();
  });
});

// The shortcuts are chosen for a German keyboard: "[", "]" need AltGr there and
// "/" needs Shift, so the arrows, F and ? are what a drafter can actually
// reach. Every one takes a modifier, because the editor holds focus almost
// always and unmodified keys are suppressed while typing.
describe('App (keyboard shortcuts and help)', () => {
  const mainCls = (container: ParentNode) => q(container, '.main').className;

  it('steps through errors with Ctrl+Down / Ctrl+Up from inside the editor', async () => {
    render(<App />);
    typeInto('The housing 12 is fixed. The casing 12 is fixed. A cover 14 sits there.');
    const label = await screen.findByText(/1 \/ \d/);
    fireEvent.keyDown(editor(), { key: 'ArrowDown', ctrlKey: true });
    await waitFor(() => expect(label.textContent).toMatch(/2 \//));
    fireEvent.keyDown(editor(), { key: 'ArrowUp', ctrlKey: true });
    await waitFor(() => expect(label.textContent).toMatch(/1 \//));
  });

  // Ctrl+Shift+Down/Up: same idea, but restricted to the term the current error
  // is about. The fixture alternates the two terms, so a jump that ignored the
  // term would land on the neighbouring error every time.
  //   1 art "banana" · 2 art "kiwi" · 3 bare "banana" · 4 bare "kiwi"
  const ALTERNATING = 'The banana 10 is here. The kiwi 12 is here. Another banana. Another kiwi.';

  it('jumps to the next error for the same term with Ctrl+Shift+Down', async () => {
    render(<App />);
    typeInto(ALTERNATING);
    const label = await screen.findByText(/1 \/ 4/);
    fireEvent.keyDown(editor(), { key: 'ArrowDown', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(label.textContent).toMatch(/3 \/ 4/));
    // …and it really is the sign-less "banana" that got selected.
    expect(editor().value.slice(editor().selectionStart, editor().selectionEnd)).toBe('banana');
  });

  it('wraps back to the first error for the term with Ctrl+Shift+Up', async () => {
    render(<App />);
    typeInto(ALTERNATING);
    const label = await screen.findByText(/1 \/ 4/);
    fireEvent.keyDown(editor(), { key: 'ArrowDown', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(label.textContent).toMatch(/3 \/ 4/));
    fireEvent.keyDown(editor(), { key: 'ArrowUp', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(label.textContent).toMatch(/1 \/ 4/));
  });

  it('follows the term of a card the user clicked, not the arrow cursor', async () => {
    const { container } = render(<App />);
    typeInto(ALTERNATING);
    await screen.findByText(/1 \/ 4/);
    const label = () => q(container, '.nav-lbl').textContent;
    // Click the "kiwi" missing-sign card: the nav cursor still sits on error 1
    // ("banana"), but the user's attention has moved.
    fireEvent.click(sidebar(container).getByText(/"kiwi" — missing sign/));
    fireEvent.keyDown(editor(), { key: 'ArrowDown', ctrlKey: true, shiftKey: true });
    // The other "kiwi" error, wrapping past the end — not error 1 or 2.
    await waitFor(() => expect(label()).toMatch(/2 \/ 4/));
  });

  it('stays put when the term has only this one error', async () => {
    render(<App />);
    typeInto('The banana 10 is here. The kiwi 12 is here.');
    const label = await screen.findByText(/1 \/ 2/);
    fireEvent.keyDown(editor(), { key: 'ArrowDown', ctrlKey: true, shiftKey: true });
    // A jump to the "kiwi" error would be exactly what the binding exists to
    // avoid, so the only correct move is none.
    await waitFor(() => expect(label.textContent).toMatch(/1 \/ 2/));
  });

  it('focuses the sign filter with Ctrl+F, which the browser find would take', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is fixed.');
    await sidebar(container).findByText('12');
    fireEvent.keyDown(editor(), { key: 'f', ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(maybe(container, '.search-in')));
  });

  it('toggles each side pane, and remembers the choice', async () => {
    const { container, unmount } = render(<App />);
    expect(mainCls(container)).not.toMatch(/left-off/);
    fireEvent.keyDown(editor(), { key: 'b', ctrlKey: true });
    await waitFor(() => expect(mainCls(container)).toMatch(/left-off/));
    fireEvent.keyDown(editor(), { key: 'B', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(mainCls(container)).toMatch(/right-off/));
    await waitFor(() => expect(localStorage.getItem('rsc_panes')).toContain('"left":false'));
    unmount();
    const again = render(<App />);
    expect(mainCls(again.container)).toMatch(/left-off/);
    expect(mainCls(again.container)).toMatch(/right-off/);
  });

  it('switches mode with Ctrl+M', async () => {
    render(<App />);
    fireEvent.keyDown(editor(), { key: 'm', ctrlKey: true });
    await waitFor(() => expect(screen.getByText('Claims').className).toMatch(/active/));
  });

  it('opens help from the ? button and from Ctrl+?, and Escape returns focus', async () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /help and keyboard/i });
    // jsdom does not focus on click the way a browser does, and the dialog
    // restores focus to whatever had it — so put it there first.
    btn.focus();
    fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // Named by its own heading, and focus starts inside rather than behind it.
    // Awaited because the dialog is a lazy chunk (LazyHelpDialog): it is in the
    // DOM one commit before its focus effect runs.
    expect(dialog).toHaveAccessibleName();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // Every shortcut the app binds is listed — the point of the screen. Exact
    // strings, since "Next error" is a prefix of the same-term binding's row.
    expect(within(dialog).getByText('Next error')).toBeInTheDocument();
    expect(within(dialog).getByText('Next error for the same term')).toBeInTheDocument();
    expect(within(dialog).getByText(/export a \.docx/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(btn);

    // "?" arrives as Shift+ß on a German layout and Shift+/ on a US one; both
    // report key === '?'.
    fireEvent.keyDown(editor(), { key: '?', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows the German modifier name when the UI is German', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('DE'));
    fireEvent.click(screen.getByRole('button', { name: /hilfe und tastenkürzel/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Strg').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Nächster Fehler')).toBeInTheDocument();
  });
});
