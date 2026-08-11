import { useEffect, useRef } from 'react';
import type { CtxAction, CtxActionData, CtxMenu as CtxMenuData } from '../logic/ctxMenuItems.ts';

export interface CtxMenuProps {
  /** The menu to show, plus where the right-click happened. */
  menu: CtxMenuData & { x: number; y: number };
  onClose: () => void;
  onAction: (action: CtxAction, data: CtxActionData) => void;
}

// ── CONTEXT MENU ────────────────────────────────────────────────────────────
export function CtxMenu({ menu, onClose, onAction }: CtxMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);
  // Where focus was before the menu opened, so it can be handed back on close
  // rather than dumped on <body>.
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (ref.current && target instanceof Node && !ref.current.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      // Roving focus through the enabled items.
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button.ctx-item') ?? [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
      items[(next + items.length) % items.length]?.focus();
    };

    // The click that opened the menu is still propagating, so the outside-click
    // listener is armed on the next tick. The timer id must be cleared on
    // unmount: a menu closed within that tick used to remove a listener that had
    // not been added yet, then the timer fired and attached one that nothing
    // ever removed — one leaked handler per fast open/close.
    const armId = setTimeout(() => document.addEventListener('mousedown', onDown), 10);
    document.addEventListener('keydown', onKey);
    firstItemRef.current?.focus();
    return () => {
      clearTimeout(armId);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      if (returnFocusRef.current instanceof HTMLElement) returnFocusRef.current.focus();
    };
  }, [onClose]);

  const x = Math.min(menu.x, window.innerWidth - 240),
    y = Math.min(menu.y, window.innerHeight - 220);
  let firstAssigned = false;
  return (
    <div className="ctx" ref={ref} style={{ left: x, top: y }} role="menu" aria-label={menu.label}>
      {menu.label && <div className="ctx-lbl">{menu.label}</div>}
      {menu.items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="ctx-sep" role="separator" />;
        const isFirst = !firstAssigned;
        firstAssigned = true;
        return (
          <button
            key={i}
            ref={isFirst ? firstItemRef : undefined}
            role="menuitem"
            className={`ctx-item ${'v' in it ? it.v : ''}`}
            onClick={() => {
              // `d` is present only on the actions that carry a payload, which
              // is exactly what the CtxMenuItem union says.
              onAction(it.a, 'd' in it ? it.d : undefined);
              onClose();
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
