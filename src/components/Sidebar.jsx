import { useState } from 'react';
import AddFeedDialog from './AddFeedDialog.jsx';
import ImportDialog from './ImportDialog.jsx';

export default function Sidebar({
  state,
  view,
  onView,
  unreadCounts,
  onAddFeed,
  onSettings,
  onRemoveFeed,
  onMoveFeed,
}) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState(null); // { url, x, y }

  const allUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return (
    <aside className="sidebar">
      <div className="side-section">
        <div className={"nav-item" + (view.kind === 'all' && view.name === null ? ' active' : '')}
           onClick={() => onView({ kind: 'all', name: null })}>
          <span className="dot" />
          <span className="label">All items</span>
          <span className="count">{allUnread}</span>
        </div>
        <div className={"nav-item " + (view.kind === 'unread' ? 'active' : '')}
           onClick={() => onView({ kind: 'unread', name: null })}>
          <span className="dot" />
          <span className="label">Unread</span>
          <span className="count">{allUnread}</span>
        </div>
      </div>

      <div className="side-section">
        <div className="side-heading">
          <span>Folders</span>
          <span className="add-btn" title="Add folder" style={{ cursor: 'pointer' }}>+</span>
        </div>
        {state.folders.map((folder) => {
          const count = unreadCounts['folder::' + folder] || 0;
          return (
            <div key={folder}
              className={"nav-item " + (view.kind === 'folder' && view.name === folder ? 'active' : '')}
              onClick={() => onView({ kind: 'folder', name: folder })}>
              <span className="dot" />
              <span className="label">{folder}</span>
              <span className="count">{count}</span>
            </div>
          );
        })}
        {state.folders.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12, padding: '4px 12px' }}>No folders yet</div>
        )}
      </div>

      <div className="side-section">
        <div className="side-heading">
          <span>Feeds</span>
          <button onClick={() => setAdding(true)} title="Add feed">+</button>
        </div>
        {state.feeds.map((feed) => {
          const count = unreadCounts[feed.url] || 0;
          return (
            <div key={feed.id}
              className={"nav-item " + (view.kind === 'feed' && view.name === feed.url ? 'active' : '') + (count ? ' has-unread' : '')}
              onClick={() => onView({ kind: 'feed', name: feed.url })}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ url: feed.url, x: e.clientX, y: e.clientY }); }}
              title={feed.url}>
              <span className="dot" />
              <span className="label">{feed.title}</span>
              <span className="del" title="Unsubscribe"
                 onClick={(e) => { e.stopPropagation(); onRemoveFeed(feed.url); }}>✕</span>
              <span className="count">{count}</span>
            </div>
          );
        })}
        {state.feeds.length === 0 && (
          <div style={{ color: 'var(--fg-muted)', fontSize: 12, padding: '4px 12px' }}>
            No feeds. Click + to subscribe.
          </div>
        )}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <button className="ghost-btn" style={ghostBtn} onClick={() => setImporting(true)}>OPML</button>
        <button className="ghost-btn" style={ghostBtn} onClick={onSettings}>⚙ Settings</button>
      </div>

      {adding && (
        <AddFeedDialog onClose={() => setAdding(false)} onAdded={(url, folder) => { setAdding(false); onAddFeed(url, folder); }} />
      )}
      {importing && (
        <ImportDialog onClose={() => setImporting(false)} onImported={() => setImporting(false)} />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          folders={state.folders}
          currentFolder={state.feeds.find((f) => f.url === menu.url)?.folder || ''}
          onMove={(folder) => onMoveFeed(menu.url, folder)}
          onDelete={() => onRemoveFeed(menu.url)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

const ghostBtn = {
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  borderRadius: 6,
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 12,
  flex: 1,
};

import ContextMenu from './ContextMenu.jsx';
