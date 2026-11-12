import { useState } from 'react';
import { importOPML, exportOPML } from '../lib/store.js';

export default function ImportDialog({ onClose, onImported }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function import_(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await importOPML(text);
      setResult(`Added ${r.count} feed(s); skipped ${r.skipped}. Folders: ${r.folders.join(', ') || 'none'}`);
      setText('');
      onImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function export_() {
    const blob = new Blob([exportOPML()], { type: 'text/opml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sscc-subscriptions.opml';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>OPML import / export</h3>
        <form onSubmit={import_}>
          <label htmlFor="opml">Paste OPML content</label>
          <textarea
            id="opml"
            placeholder="<opml>…</opml>"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <div className="error">{error}</div>}
          {result && <div className="hint" style={{ color: 'var(--accent)' }}>{result}</div>}
          <div className="row">
            <button type="button" className="button ghost" onClick={export_}>Export current feeds</button>
            <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={busy || !text.trim()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
