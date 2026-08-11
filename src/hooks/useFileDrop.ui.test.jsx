import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useFileDrop } from './useFileDrop.js';

function Harness({ onFile }) {
  const dragging = useFileDrop(onFile);
  return <div data-testid="state">{dragging ? 'dragging' : 'idle'}</div>;
}

// jsdom has no DataTransfer, so build the shape the hook actually reads.
const dragEvent = (type, { withFiles = true, files = [] } = {}) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = { types: withFiles ? ['Files'] : [], files };
  return e;
};
const fire = (e) => act(() => void window.dispatchEvent(e));

describe('useFileDrop', () => {
  it('enters the dragging state when files are dragged in', () => {
    const { getByTestId } = render(<Harness onFile={() => {}} />);
    fire(dragEvent('dragenter'));
    expect(getByTestId('state')).toHaveTextContent('dragging');
  });

  it('balances nested dragenter/dragleave from child elements', () => {
    const { getByTestId } = render(<Harness onFile={() => {}} />);
    fire(dragEvent('dragenter'));
    fire(dragEvent('dragenter'));
    fire(dragEvent('dragleave'));
    expect(getByTestId('state')).toHaveTextContent('dragging');
    fire(dragEvent('dragleave'));
    expect(getByTestId('state')).toHaveTextContent('idle');
  });

  it('clears on dragleave even when the browser hides dataTransfer.types', () => {
    // Several browsers expose an empty types list on dragleave for privacy.
    // Gating the decrement on it left the counter stuck above zero and the drop
    // overlay pinned on screen until the next successful drop.
    const { getByTestId } = render(<Harness onFile={() => {}} />);
    fire(dragEvent('dragenter'));
    fire(dragEvent('dragleave', { withFiles: false }));
    expect(getByTestId('state')).toHaveTextContent('idle');
  });

  it('clears on dragend, which fires when a drag is abandoned', () => {
    // Escape or dropping outside the window fires neither drop nor a balancing
    // dragleave, so without this the overlay stayed up.
    const { getByTestId } = render(<Harness onFile={() => {}} />);
    fire(dragEvent('dragenter'));
    fire(dragEvent('dragenter'));
    fire(dragEvent('dragend'));
    expect(getByTestId('state')).toHaveTextContent('idle');
  });

  it('passes the dropped file on and clears the state', () => {
    const onFile = vi.fn();
    const file = new File(['x'], 'a.docx');
    const { getByTestId } = render(<Harness onFile={onFile} />);
    fire(dragEvent('dragenter'));
    fire(dragEvent('drop', { files: [file] }));
    expect(onFile).toHaveBeenCalledWith(file);
    expect(getByTestId('state')).toHaveTextContent('idle');
  });

  it('prevents the default on dragover, or the browser opens the file', () => {
    render(<Harness onFile={() => {}} />);
    const e = dragEvent('dragover');
    fire(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores drags that carry no files', () => {
    const { getByTestId } = render(<Harness onFile={() => {}} />);
    fire(dragEvent('dragenter', { withFiles: false }));
    expect(getByTestId('state')).toHaveTextContent('idle');
  });
});
