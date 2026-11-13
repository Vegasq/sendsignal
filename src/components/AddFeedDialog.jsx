import { useState } from 'react';
import { addFeed, addFeedFromBody } from '../lib/store.js';

export default function AddFeedDialog({ folders, onClose, onAdded }) {
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const useNew = folder === '__new__';

  async function submit(e) {
    e.preventDefault();
    const target = url.trim();
    if (!target) {
      setError('Enter a feed URL.');
      return;
    }
    const targetFolder = useNew ? newFolder.trim() : folder;
    setBusy(true);
    setError('');
    try {
      if (target.startsWith('<')) {
        // Pasted raw XML: parse locally, no network. Synthetic key since there's
        // no origin URL to fetch.
        const feedUrl =
          'pasted-feed:' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        await addFeedFromBody(feedUrl, target, targetFolder);
        onAdded(feedUrl, targetFolder);
      } else {
        await addFeed(normalizeUrl(target), targetFolder);
        onAdded(target, targetFolder);
      }
    } catch (err) {
      setError('Could not subscribe: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Subscribe to a feed</h3>
        <form onSubmit={submit}>
          <label htmlFor="feed-url">Feed URL or XML</label>
          <input
            id="feed-url"
            autoFocus
            value={url}
            placeholder="https://example.com/rss"
            onChange={(e) => setUrl(e.target.value)}
          />
          <label htmlFor="feed-folder">Folder</label>
          <select value={useNew ? '__new__' : folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">None</option>
            {folders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
            <option value="__new__">+ New folder…</option>
          </select>
          {useNew && (
            <input
              placeholder="Folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
          )}
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? 'Subscribing…' : 'Subscribe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function normalizeUrl(url) {
  return url;
}
