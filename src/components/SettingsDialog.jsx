export default function SettingsDialog({ theme, proxy, intervalMs, onClose, onSetTheme, onSetProxy, onSetInterval }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <label>Theme</label>
        <select value={theme} onChange={(e) => onSetTheme(e.target.value)}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>

        <label htmlFor="refresh-interval">Refresh interval</label>
        <select id="refresh-interval" value={String(intervalMs)} onChange={(e) => onSetInterval(e.target.value)}>
          <option value={15 * 60000 + ''}>Every 15 minutes</option>
          <option value={30 * 60000 + ''}>Every 30 minutes</option>
          <option value={60 * 60000 + ''}>Every hour</option>
          <option value={180 * 60000 + ''}>Every 3 hours</option>
        </select>
        <div className="hint">
          While the tab is open, feeds are also refreshed when you return to it. Use the
          ⟳ button for an immediate refresh.
        </div>

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
