// Modal listing the keyboard shortcuts. Opened with `?`; closed with Esc, a
// click outside, or the ✕ button.
const HOTKEYS = [
  { keys: 'j / ↓', action: 'Next article' },
  { keys: 'k / ↑', action: 'Previous article' },
  { keys: 'g / Home', action: 'First article' },
  { keys: 'G / End', action: 'Last article' },
  { keys: 'x', action: 'Mark article read' },
  { keys: 'u', action: 'Mark article unread' },
  { keys: '?', action: 'Show this help' },
];

export default function HelpModal({ onClose }) {
  return (
    <div className="help-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="help-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <button className="help-close" onClick={onClose} aria-label="Close (Esc)">✕</button>
        <h2 id="help-title">Hotkeys</h2>
        <ul className="help-list">
          {HOTKEYS.map((h) => (
            <li key={h.action}>
              <span className="help-keys">{h.keys}</span>
              <span className="help-action">{h.action}</span>
            </li>
          ))}
        </ul>
        <p className="help-hint">
          Press <span className="kbd">?</span> or <span className="kbd">Esc</span> to close.
        </p>
      </div>
    </div>
  );
}
