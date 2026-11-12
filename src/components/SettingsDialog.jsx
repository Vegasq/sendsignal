export default function SettingsDialog({ theme, proxy, onClose, onSetTheme, onSetProxy }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <label>Theme</label>
        <select value={theme} onChange={(e) => onSetTheme(e.target.value)}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>

        <label htmlFor="proxy">Custom feed proxy (optional)</label>
        <input
          id="proxy"
          value={proxy}
          placeholder="https://myproxy.example/?url="
          onChange={(e) => onSetProxy(e.target.value)}
        />
        <div className="hint">
          A template with a single <code>{'{url}'}</code> placeholder. Left empty to use the
          built-in public proxies.
        </div>

        <div className="row">
          <button className="button ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
