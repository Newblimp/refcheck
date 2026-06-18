import { useEffect, useRef } from 'react';

// ── CONTEXT MENU ────────────────────────────────────────────────────────────
export function CtxMenu({ menu, onClose, onAction }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h), 10);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const x = Math.min(menu.x, window.innerWidth - 240), y = Math.min(menu.y, window.innerHeight - 220);
  return (
    <div className="ctx" ref={ref} style={{ left: x, top: y }}>
      {menu.label && <div className="ctx-lbl">{menu.label}</div>}
      {menu.items.map((it, i) => it.sep ? <div key={i} className="ctx-sep" /> :
        <button key={i} className={`ctx-item ${it.v || ''}`} onClick={() => { onAction(it.a, it.d); onClose(); }}>
          {it.label}
        </button>
      )}
    </div>
  );
}
