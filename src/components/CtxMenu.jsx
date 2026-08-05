import { useEffect, useRef } from 'react';

// ── CONTEXT MENU ────────────────────────────────────────────────────────────
export function CtxMenu({ menu, onClose, onAction }) {
  const ref = useRef(null);
  const firstItemRef = useRef(null);
  // Where focus was before the menu opened, so it can be handed back on close
  // rather than dumped on <body>.
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      // Roving focus through the enabled items.
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll('button.ctx-item') || [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
      items[(next + items.length) % items.length].focus();
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
      returnFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const x = Math.min(menu.x, window.innerWidth - 240),
    y = Math.min(menu.y, window.innerHeight - 220);
  let firstAssigned = false;
  return (
    <div className="ctx" ref={ref} style={{ left: x, top: y }} role="menu" aria-label={menu.label}>
      {menu.label && <div className="ctx-lbl">{menu.label}</div>}
      {menu.items.map((it, i) => {
        if (it.sep) return <div key={i} className="ctx-sep" role="separator" />;
        const isFirst = !firstAssigned;
        firstAssigned = true;
        return (
          <button
            key={i}
            ref={isFirst ? firstItemRef : undefined}
            role="menuitem"
            className={`ctx-item ${it.v || ''}`}
            onClick={() => {
              onAction(it.a, it.d);
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
