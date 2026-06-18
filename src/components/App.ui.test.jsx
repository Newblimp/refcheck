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
});
