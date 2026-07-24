import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { App } from './App.jsx';

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
    fireEvent.click(screen.getByText('Light'));
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
