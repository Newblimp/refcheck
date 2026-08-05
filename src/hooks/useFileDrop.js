import { useEffect, useState, useRef } from 'react';

// Window-level file drag/drop.
//
// The handlers must live on `window`, not on a wrapper div: dropping a file on a
// <textarea> has default browser behaviour (Chrome opens/navigates to the file),
// and only a preventDefault that the browser sees on BOTH dragover and drop
// suppresses it. dragenter/dragleave are counted because they also fire for
// every child element the pointer crosses.
export function useFileDrop(onFile) {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onFile);
  cb.current = onFile;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let depth = 0;
    const hasFiles = (e) => {
      const types = e.dataTransfer?.types;
      return types && Array.prototype.indexOf.call(types, 'Files') !== -1;
    };
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without this the browser opens the file on drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) cb.current?.(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return dragging;
}
