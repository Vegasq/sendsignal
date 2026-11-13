import { useState } from 'react';
import { createFolder } from '../lib/store.js';
import AddFeedDialog from './AddFeedDialog.jsx';
import ImportDialog from './ImportDialog.jsx';
import ContextMenu from './ContextMenu.jsx';

export default function Sidebar({
  state,
  view,
  onView,
  unreadCounts,
  onAddFeed,
  onCreateFolder,
  onSettings,
  onRemoveFeed,
  onMoveFeed,
}) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState(null); // { url, x, y }
  const [creating, setCreating] = useState(false); // inline new-folder input
  const [newFolder, setNewFolder] = useState('');

  const allUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  function submitFolder(e) {
    if (e) e.preventDefault();
    const name = newFolder.trim();
    if (name) onCreateFolder(name);
    setNewFolder('');
    setCreating(false);
  }

  function handleDrop(e, folder) {
    e.preventDefault();
    const url = e.dataTransfer.getData('text/plain');
    if (url) onMoveFeed(url, folder);
    e.target.closest('.nav-item')?.classList.remove('drop-active');
  }

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
        <div className={"nav-item " + (view.kind === 'saved' ? 'active' : '')}
           onClick={() => onView({ kind: 'saved', name: null })}
           title="Saved articles">
          <span className="dot" />
          <span className="label">Saved</span>
          <span className="count">{unreadCounts.saved || 0}</span>
        </div>
      </div>

      <div className="side-section">
        <div className="side-heading">
          <span>Folders</span>
          <span className="add-btn" title="Add folder" style={{ cursor: 'pointer' }}
             onClick={() => { setCreating(true); setNewFolder(''); }}>+</span>
        </div>
        {creating && (
          <form className="new-folder-form" onSubmit={submitFolder} onMouseDown={(e) => e.stopPropagation()}>
            <input
              className="new-folder-input"
              placeholder="Folder name"
              autoFocus
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onBlur={submitFolder}
            />
            <span className="new-folder-cancel" title="Cancel (Esc)"
              onMouseDown={(e) => { e.stopPropagation(); setCreating(false); setNewFolder(''); }}>✕</span>
          </form>
        )}
        {state.folders.map((folder) => {
          const count = unreadCounts['folder::' + folder] || 0;
          return (
            <div
              key={folder}
              className={"nav-item drop-target" + (view.kind === 'folder' && view.name === folder ? ' active' : '')}
              onClick={() => onView({ kind: 'folder', name: folder })}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.target.closest('.nav-item')?.classList.add('drop-active'); }}
              onDragLeave={(e) => { e.target.closest('.nav-item')?.classList.remove('drop-active'); }}
              onDrop={(e) => handleDrop(e, folder)}>
              <span className="dot" />
              <span className="label">{folder}</span>
              <span className="count">{count}</span>
            </div>
          );
        })}
        {state.folders.length === 0 && !creating && (
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
            <div
              key={feed.id}
              draggable
              className={"nav-item" + (view.kind === 'feed' && view.name === feed.url ? ' active' : '') + (count ? ' has-unread' : '')}
              onClick={() => onView({ kind: 'feed', name: feed.url })}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', feed.url);
                e.dataTransfer.effectAllowed = 'move';
                e.target.closest('.nav-item')?.classList.add('dragging');
              }}
              onDragEnd={(e) => { e.target.closest('.nav-item')?.classList.remove('dragging'); }}
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
        <div
          className={"nav-item subtle drop-target"}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.target.closest('.nav-item')?.classList.add('drop-active'); }}
          onDragLeave={(e) => { e.target.closest('.nav-item')?.classList.remove('drop-active'); }}
          onDrop={(e) => handleDrop(e, '')}
          title="Drop a feed here to remove it from its folder">
          <span className="dot" />
          <span className="label">Uncategorized</span>
        </div>
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <button className="ghost-btn" style={ghostBtn} onClick={() => setImporting(true)}>OPML</button>
        <button className="ghost-btn" style={ghostBtn} onClick={onSettings}>⚙ Settings</button>
      </div>

      {adding && (
        <AddFeedDialog
          folders={state.folders}
          onClose={() => setAdding(false)}
          onAdded={(url, folder) => { setAdding(false); onAddFeed(url, folder); }}
        />
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
