import { useEffect, useState, useRef } from 'react';

// Window-level file drag/drop.
//
// The handlers must live on `window`, not on a wrapper div: dropping a file on a
// <textarea> has default browser behaviour (Chrome opens/navigates to the file),
// and only a preventDefault that the browser sees on BOTH dragover and drop
// suppresses it. dragenter/dragleave are counted because they also fire for
// every child element the pointer crosses.
export function useFileDrop(onFile: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onFile);
  cb.current = onFile;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without this the browser opens the file on drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    // Deliberately NOT gated on hasFiles: several browsers expose an empty
    // dataTransfer.types on dragleave for privacy reasons, and skipping the
    // decrement there left the counter permanently above zero — the overlay then
    // stayed on screen until the next successful drop.
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) cb.current?.(file);
    };
    // A drag abandoned with Escape, or ended outside the window, fires neither
    // drop nor a balancing dragleave.
    const onEnd = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onEnd);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onEnd);
    };
  }, []);

  return dragging;
}
