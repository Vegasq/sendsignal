import { useEffect, useRef, useState } from 'react';

// Minimal right-click menu for feed rows: move to a folder, move to none, or
// unsubscribe. Native context menu is suppressed so this is the only menu.
export default function ContextMenu({ x, y, folders, currentFolder, onMove, onClose, onDelete }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: x, y: y });

  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the menu on screen.
  if (pos.x + 180 > window.innerWidth) pos.x = window.innerWidth - 185;
  if (pos.y + (folders.length + 3) * 32 > window.innerHeight) pos.y = window.innerHeight - (folders.length + 3) * 32 - 4;

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 50 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={sheet}>
        {folders.length === 0 ? (
          <div style={{ ...item, color: 'var(--fg-muted)' }}>No folders</div>
        ) : (
          folders.map((f) => (
            <div key={f} style={{ ...item, fontWeight: f === currentFolder ? 700 : 400 }}
              onClick={() => { onMove(f); onClose(); }}>
              📁 {f}
            </div>
          ))
        )}
        <div style={divider} />
        <div style={{ ...item, color: 'var(--badge)' }} onClick={() => { onDelete(); onClose(); }}>
          ✕ Unsubscribe
        </div>
      </div>
    </div>
  );
}

const sheet = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
  padding: '4px',
  minWidth: 160,
};

const item = {
  padding: '7px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

const divider = { height: 1, background: 'var(--border)', margin: '4px 2px' };
