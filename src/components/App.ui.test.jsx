import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App } from './App.jsx';
import { makeDocx, DE_BODY } from '../logic/docx/fixture.js';

// jsdom's File has no arrayBuffer() in this version, so provide the bytes the
// import path actually reads.
const docxFile = (body, name = 'application.docx') => {
  const bytes = makeDocx(body);
  const file = new File([bytes], name);
  file.arrayBuffer = () =>
    Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return file;
};

// DOM-level tests for the interactive layer (runs under jsdom via the
// *.ui.test.jsx glob in vite.config.js).

// The editor textarea and the highlight backdrop both contain the text, and a
// search input appears once signs exist — so target the editor by class and
// scope sidebar assertions to the overview pane.
const editor = () => document.querySelector('.editor-ta');
const typeInto = (text) => fireEvent.change(editor(), { target: { value: text } });
const sidebar = (container) => within(container.querySelector('.ov-scroll'));

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
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
    await waitFor(() => expect(container.querySelector('.badge.warn')).toBeTruthy());
    fireEvent.click(container.querySelector('.sign-card .dis-btn'));
    await waitFor(() => expect(container.querySelector('.badge.warn')).toBeFalsy());
  });

  it('collapses and re-expands a sidebar card section on header click', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    await waitFor(() => expect(container.querySelector('.sign-card')).toBeTruthy());
    const hdr = sidebar(container).getByText(/Inconsistencies/);
    expect(container.querySelector('.sidebar-section .sign-card')).toBeTruthy();
    fireEvent.click(hdr);
    expect(container.querySelector('.sidebar-section .sign-card')).toBeFalsy();
    fireEvent.click(hdr);
    expect(container.querySelector('.sidebar-section .sign-card')).toBeTruthy();
  });

  it('navigation buttons cycle through errors', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    await waitFor(() => expect(container.querySelector('.nav-lbl')).toBeTruthy());
    expect(container.querySelector('.nav-lbl').textContent).toMatch(/^1 \//);
    const [, next] = container.querySelectorAll('.nav-btn');
    fireEvent.click(next);
    expect(container.querySelector('.nav-lbl').textContent).toMatch(/^2 \//);
  });

  it('clicking a sign card cycles through its occurrences, then unfocuses', async () => {
    const { container } = render(<App />);
    typeInto('The housing 12 is the casing 12.');
    const card = await waitFor(() => {
      const c = container.querySelector('.sign-card');
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
    expect(container.querySelector('.sign-card.focused')).toBeFalsy();
    fireEvent.click(card); // cycle restarts at the first
    expect(ed.selectionStart).toBe(first);
  });

  it('copies the reference list to the clipboard', async () => {
    const { container } = render(<App />);
    typeInto('The device 10 has a housing 12.');
    await waitFor(() => expect(container.querySelector('.reflist-section')).toBeTruthy());
    fireEvent.click(container.querySelector('.reflist-hdr')); // expand
    fireEvent.click(container.querySelector('.reflist-section .restore-btn')); // copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('10\tdevice\n12\thousing');
    expect(
      await within(container.querySelector('.reflist-section')).findByText('Copied')
    ).toBeInTheDocument();
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
    await waitFor(() =>
      expect(container.querySelector('.lang-toggle button.active').textContent).toBe('DE')
    );
    // Warnings render in the language the import just switched TO, not the one
    // that was active when the file was dropped.
    expect(await screen.findByText(/automatisch nummerierte Ansprüche/)).toBeInTheDocument();
    // Claims landed in the other buffer, with auto-numbering reconstructed.
    fireEvent.click(screen.getByText('Ansprüche'));
    expect(editor().value).toMatch(/^1\. Vorrichtung \(10\)/);
  });

  it('undo restores the buffers that the import replaced', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(<App />);
    typeInto('The housing 12 is large.');
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [docxFile(DE_BODY)] } });
    await waitFor(() => expect(editor().value).toContain('Gehäuse 12'));

    fireEvent.click(await screen.findByText(/Rückgängig|Undo/));
    await waitFor(() => expect(editor().value).toBe('The housing 12 is large.'));
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
    expect(container.querySelector('.bee-wrap')).toBeFalsy();

    typeInto('The bee 12 is large.');
    const bee = await waitFor(() => {
      const el = container.querySelector('.bee-wrap');
      expect(el).toBeTruthy();
      return el;
    });
    // The bubble carries the joke, and is hidden until the pointer is near.
    const bubble = bee.querySelector('.bee-bubble');
    expect(bubble.textContent).toBe("§ 961 BGB! I'm free!!");
    expect(bubble.className).not.toContain('show');
    // The bee must never intercept pointer events from the editor.
    expect(bee.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the German bubble text when the UI is German', async () => {
    localStorage.setItem('rsc_lang', 'de');
    const { container } = render(<App />);
    typeInto('Die Biene bee 12.');
    await waitFor(() => expect(container.querySelector('.bee-bubble')).toBeTruthy());
    expect(container.querySelector('.bee-bubble').textContent).toBe('§ 961 BGB! Ich bin frei!!');
  });

  it('keeps the bee flying while the user carries on typing', async () => {
    // Regression: onDone used to be a fresh closure each render, so every
    // keystroke tore down the animation effect and respawned the bee just
    // off-screen — it never flew in.
    const { container } = render(<App />);
    typeInto('a bee ');
    await waitFor(() => expect(container.querySelector('.bee-wrap')).toBeTruthy());
    const first = container.querySelector('.bee-wrap');
    typeInto('a bee and the housing 12 keeps being typed');
    typeInto('a bee and the housing 12 keeps being typed further');
    // Same element instance — the flight was never restarted.
    expect(container.querySelector('.bee-wrap')).toBe(first);
  });

  it('still summons a bee on an explicit request under prefers-reduced-motion', async () => {
    // The setting suppresses the RANDOM appearances, but typing "bee" is an
    // explicit by-name request; silently doing nothing just looks broken.
    const mm = window.matchMedia;
    window.matchMedia = (q) => ({
      matches: /prefers-reduced-motion/.test(q),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    try {
      const { container } = render(<App />);
      typeInto('This should spawn a bee');
      await waitFor(() => expect(container.querySelector('.bee-wrap')).toBeTruthy());
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
    await waitFor(() => expect(container.querySelector('.bee-wrap')).toBeTruthy());
    expect(container.querySelector('.bee-bubble').textContent).toBe('§ 961 BGB! Ich bin frei!!');
  });

  it('"Biene" does nothing in English, and switching language does not summon one', async () => {
    const { container } = render(<App />);
    typeInto('Eine Biene sitzt auf dem Gehäuse 12.');
    await waitFor(() => expect(sidebar(container).getByText('12')).toBeInTheDocument());
    expect(container.querySelector('.bee-wrap')).toBeFalsy();
    // Flipping to German re-baselines rather than reading the jump as a request.
    fireEvent.click(screen.getByText('DE'));
    await waitFor(() => expect(screen.getByText('Ansprüche')).toBeInTheDocument());
    expect(container.querySelector('.bee-wrap')).toBeFalsy();
  });

  it('does not summon a bee just for restoring a buffer that already says "bee"', async () => {
    localStorage.setItem('rsc_desc', 'The bee 12 is large.');
    const { container } = render(<App />);
    await waitFor(() => expect(editor().value).toContain('bee'));
    expect(container.querySelector('.bee-wrap')).toBeFalsy();
  });

  it('restores persisted text on load and clears it on reset', async () => {
    localStorage.setItem('rsc_desc', 'The housing 12 is large.');
    const { container } = render(<App />);
    expect(editor().value).toBe('The housing 12 is large.');
    expect(await sidebar(container).findByText('12')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(container.querySelector('.reset-btn'));
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
    const card = sidebar(container)
      .getByText(/nonexistent claim 3/)
      .closest('.bare-card');
    fireEvent.click(card.querySelector('.dis-btn'));
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
    expect(JSON.parse(localStorage.getItem('rsc_mwo'))).toHaveProperty('unit', 1);
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

  it('restores persisted dismissals on load', async () => {
    localStorage.setItem('rsc_desc', 'The housing 12 is the casing 12.');
    localStorage.setItem('rsc_dis', JSON.stringify(['s:12']));
    const { container } = render(<App />);
    // The warned sign is already dismissed → dim badge, no warn badge.
    await waitFor(() => expect(container.querySelector('.badge.dim')).toBeTruthy());
    expect(container.querySelector('.badge.warn')).toBeFalsy();
  });
});

describe('App (keyboard and accessibility)', () => {
  const CONFLICT = 'The housing 12 is fixed. The casing 12 is fixed. A cover 14 is on.';

  it('steps through errors with Ctrl+] and Ctrl+[', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const label = () => container.querySelector('.nav-lbl')?.textContent;
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
    const card = container.querySelector('.sign-card');
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
    const card = container.querySelector('.sign-card');
    fireEvent.keyDown(card, { key: ' ' });
    await waitFor(() => expect(card.className).toMatch(/focused/));
  });

  it('collapsible section headers expose their expanded state', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const header = container.querySelector('.sec-lbl-toggle');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    await waitFor(() => expect(header).toHaveAttribute('aria-expanded', 'false'));
  });

  it('"/" focuses the sign filter, but not while typing in the editor', async () => {
    const { container } = render(<App />);
    typeInto(CONFLICT);
    await sidebar(container).findByText('12');
    const search = container.querySelector('.search-in');

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

  it('exposes main and complementary landmarks', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('gives the editor an accessible name', () => {
    render(<App />);
    expect(screen.getByRole('textbox', { name: /patent text/i })).toBeInTheDocument();
  });
});

describe('App (reference-list check and claim statistics)', () => {
  const refListInput = (container) => container.querySelector('.rlc-in');

  it('reports a reference list that matches the text', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided. The housing 12 holds a cover 14.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), {
      target: { value: '12 housing\n14 cover' },
    });
    expect(await sidebar(container).findByText(/2 entries match the text/)).toBeInTheDocument();
  });

  it('flags a term that differs between the list and the text', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided. The housing 12 holds a cover 14.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), {
      target: { value: '12 casing\n14 cover' },
    });
    expect(
      await sidebar(container).findByText(/list: "casing".*text: "housing"/)
    ).toBeInTheDocument();
  });

  it('flags a sign listed but never used, and one used but not listed', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided. The housing 12 holds a cover 14.');
    await sidebar(container).findByText('12');
    fireEvent.change(refListInput(container), {
      target: { value: '12 housing\n99 flywheel' },
    });
    expect(await sidebar(container).findByText(/never used in the text/)).toBeInTheDocument();
    expect(sidebar(container).getByText(/not listed/)).toBeInTheDocument();
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
    await waitFor(() => expect(document.querySelector('.editor-ta')).toBeInTheDocument());
    const dt = { types: ['Files'], files: [file] };
    fireEvent(
      window,
      Object.assign(new Event('dragenter', { bubbles: true }), { dataTransfer: dt })
    );
    fireEvent(window, Object.assign(new Event('drop', { bubbles: true }), { dataTransfer: dt }));
    await waitFor(() => expect(refListInput(container).value).toBe('10 Vorrichtung\n12 Gehäuse'));
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
    await waitFor(() => expect(container.querySelector('.cs-body')).toBeInTheDocument());
    const stats = within(container.querySelector('.cs-body'));
    expect(stats.getByText('Count').previousSibling).toHaveTextContent('3');
    expect(stats.getByText(/multiple dependency: claim 3/)).toBeInTheDocument();
  });

  it('does not show claim statistics in description mode', async () => {
    const { container } = render(<App />);
    typeInto('A housing 12 is provided.');
    await sidebar(container).findByText('12');
    expect(container.querySelector('.cs-body')).not.toBeInTheDocument();
  });
});
