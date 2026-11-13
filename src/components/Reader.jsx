import { useEffect, useRef } from 'react';
import { setRead } from '../lib/store.js';
import { selectRow } from '../lib/view.js';
import { timeAgo } from '../lib/util.js';

export default function Reader({ state, view, search, list, selectedKey, onSelect, onToggleRead, onOpenOriginal }) {
  // Auto-mark-read removes the viewed article from the unread-only list, so the
  // selection context must persist across renders: keep showing the selected
  // article (and its Previous/Next neighbors) until selection changes.
  const selRef = useRef(null);
  selRef.current = selectRow(list, selectedKey, selRef.current);
  const { row, prev, next } = selRef.current ?? {};

  // Auto-mark the visible article read; keep the checkbox authoritative.
  useEffect(() => {
    if (row && !row.isRead) onToggleRead(row.key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  if (!row) {
    return <div className="reader empty">Select an article to read it.</div>;
  }

  const { item, feedUrl } = row;
  const ft = state.feeds.find((f) => f.url === feedUrl)?.title || feedUrl;
  const key = row.key;

  return (
    <div className="reader">
      <article>
        <div className="r-actions">
          <button onClick={() => onToggleRead(key, !row.isRead)}>
            {row.isRead ? '↩ Mark unread' : '✓ Mark read'}
          </button>
          <button onClick={() => onOpenOriginal(item.link)} disabled={!item.link}>
            Open original ↗
          </button>
        </div>
        <h1>{item.title}</h1>
        <div className="r-meta">
          <strong>{ft}</strong>
          {item.author && <> · {item.author}</>}
          {item.published && <> · {timeAgo(item.published)}</>}
        </div>
        <div
          className="content"
          dangerouslySetInnerHTML={{ __html: sanitize(item.content) }}
        />
        <div className="nav">
          <button onClick={() => onSelect(prev?.key)} disabled={!prev}>← Previous</button>
          <button onClick={() => onSelect(next?.key)} disabled={!next}>Next →</button>
        </div>
      </article>
    </div>
  );
}

// Minimal sanitizer: feeds ship their own HTML; strip <script>, event
// attributes, and javascript: URLs to avoid XSS from a malicious feed.
function sanitize(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove());
  div.querySelectorAll('*').forEach((n) => {
    for (const attr of [...n.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) n.removeAttribute(attr.name);
      if (name === 'href' || name === 'src') {
        const v = attr.value.trim().toLowerCase();
        if (v.startsWith('javascript:') || v.startsWith('data:') && !v.startsWith('data:image/')) {
          n.removeAttribute(attr.name);
        }
      }
    }
  });
  return div.innerHTML;
}
