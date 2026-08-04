import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App } from './App.jsx';
import { makeDocx, DE_BODY } from '../logic/docx/fixture.js';

// jsdom's File has no arrayBuffer() in this version, so provide the bytes the
// import path actually reads.
const docxFile = (body, name = 'application.docx') => {
  const bytes = makeDocx(body);
  const file = new File([bytes], name);
  file.arrayBuffer = () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
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
  try { localStorage.clear(); } catch {}
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

    fireEvent.click(card);                       // 1st click → first occurrence
    expect(ed.selectionStart).toBe(first);
    fireEvent.click(card);                       // 2nd click → next occurrence
    expect(ed.selectionStart).toBe(second);
    fireEvent.click(card);                       // past the last → unfocus
    expect(container.querySelector('.sign-card.focused')).toBeFalsy();
    fireEvent.click(card);                       // cycle restarts at the first
    expect(ed.selectionStart).toBe(first);
  });

  it('copies the reference list to the clipboard', async () => {
    const { container } = render(<App />);
    typeInto('The device 10 has a housing 12.');
    await waitFor(() => expect(container.querySelector('.reflist-section')).toBeTruthy());
    fireEvent.click(container.querySelector('.reflist-hdr')); // expand
    fireEvent.click(container.querySelector('.reflist-section .restore-btn')); // copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('10\tdevice\n12\thousing');
    expect(await within(container.querySelector('.reflist-section')).findByText('Copied')).toBeInTheDocument();
  });

  it('imports a dropped .docx into both buffers and sets the language', async () => {
    const { container } = render(<App />);
    const file = docxFile(DE_BODY);
    fireEvent.drop(window, { dataTransfer: { types: ['Files'], files: [file] } });

    await waitFor(() => expect(editor().value).toContain('Die Vorrichtung 10 umfasst ein Gehäuse 12.'));
    // Only the detailed description — not the abstract, figure listing or sign list.
    expect(editor().value).not.toContain('Die Erfindung betrifft');
    expect(editor().value).not.toContain('Fig. 1 zeigt');
    expect(editor().value).not.toContain('10 Vorrichtung');
    // Language switched to German off the "Patentansprüche" heading.
    await waitFor(() =>
      expect(container.querySelector('.lang-toggle button.active').textContent).toBe('DE'));
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
    window.matchMedia = q => ({
      matches: /prefers-reduced-motion/.test(q),
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
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
    expect(await sidebar(container).findByText(/in claims, not in description/)).toBeInTheDocument();
  });

  it('flags a bad claim dependency and dismisses it from its card', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByText('Claims'));
    typeInto('1. A device (10) according to claim 3.');
    expect(await sidebar(container).findByText(/nonexistent claim 3/)).toBeInTheDocument();
    const card = sidebar(container).getByText(/nonexistent claim 3/).closest('.bare-card');
    fireEvent.click(card.querySelector('.dis-btn'));
    await waitFor(() =>
      expect(sidebar(container).queryByText(/nonexistent claim 3/)).not.toBeInTheDocument());
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
