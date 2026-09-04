import { UploadIcon } from './icons.tsx';
import type { Strings } from '../i18n.ts';

// Full-window drop affordance, shown only while a file is being dragged over
// the page. It sits above the editor's textarea + backdrop layers, but is
// pointer-events:none so it never interferes with the editor's hover
// hit-testing (useEditorSync toggles pointerEvents on the textarea to find marks).
export interface DropOverlayProps {
  visible: boolean;
  t: Strings;
}

export function DropOverlay({ visible, t }: DropOverlayProps) {
  if (!visible) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-card">
        <UploadIcon />
        <strong>{t.impDropTitle}</strong>
        <span>{t.impDropHint}</span>
      </div>
    </div>
  );
}
