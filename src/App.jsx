import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribe, getState, setRead, markAllRead, setTheme, setUserProxy, removeFeed, addFeed, moveFeed } from './lib/store.js';
import { buildList, unreadCounts } from './lib/view.js';
import Sidebar from './components/Sidebar.jsx';
import ArticleList from './components/ArticleList.jsx';
import Reader from './components/Reader.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';

export default function App() {
  const [state, setState] = useState(getState);
  const [view, setView] = useState({ kind: 'unread', name: null });
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  const list = useMemo(() => buildList(state, view, search), [state, view, search]);

  const counts = useMemo(() => unreadCounts(state), [state]);

  const handleView = useCallback((v) => {
    setView(v);
    setSelectedKey(null);
  }, []);

  const handleSelect = useCallback((row) => {
    setSelectedKey(row.key);
    const reader = document.querySelector('.reader');
    if (reader) reader.scrollTop = 0;
  }, []);

  const handleToggleRead = useCallback((key, isRead) => {
    setRead(key, isRead);
    if (!isRead && selectedKey === key) setSelectedKey(null);
  }, [selectedKey]);

  const handleMarkAllRead = useCallback((v) => {
    if (v.kind === 'feed') markAllRead(v.name);
    else if (v.kind === 'folder') markAllRead(state.feeds.filter((f) => f.folder === v.name).map((f) => f.url));
    else markAllRead('all');
  }, [state.feeds]);

  const handleRemoveFeed = useCallback((url) => {
    removeFeed(url);
    setSelectedKey((k) => (k && k.startsWith(url + '::')) ? null : k);
  }, []);

  const handleOpenOriginal = useCallback((url) => {
    if (url) window.open(url, '_blank', 'noopener');
  }, []);

  return (
    <div className="app">
      <Header
        search={search}
        onSearch={setSearch}
        theme={state.theme}
        onToggleTheme={() => setTheme(state.theme === 'dark' ? 'light' : 'dark')}
        onSettings={() => setSettingsOpen(true)}
      />
      <Sidebar
        state={state}
        view={view}
        onView={handleView}
        unreadCounts={counts}
        onAddFeed={(url, folder) => addFeed(url, folder)}
        onSettings={() => setSettingsOpen(true)}
        onRemoveFeed={handleRemoveFeed}
        onMoveFeed={(url, folder) => moveFeed(url, folder)}
      />
      <ArticleList
        state={state}
        view={view}
        search={search}
        onSelect={handleSelect}
        onMarkAllRead={handleMarkAllRead}
      />
      <Reader
        state={state}
        view={view}
        search={search}
        list={list}
        selectedKey={selectedKey}
        onSelect={handleSelect}
        onToggleRead={handleToggleRead}
        onOpenOriginal={handleOpenOriginal}
      />
      {settingsOpen && (
        <SettingsDialog
          theme={state.theme}
          proxy={state.proxy}
          onClose={() => setSettingsOpen(false)}
          onSetTheme={(t) => setTheme(t)}
          onSetProxy={(p) => setUserProxy(p)}
        />
      )}
    </div>
  );
}

function Header({ search, onSearch, theme, onToggleTheme, onSettings }) {
  return (
    <header className="header">
      <div className="logo">s<span>s</span>cc</div>
      <input
        className="search"
        type="search"
        placeholder="Search articles…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className="spacer" />
      <button className="icon" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="icon" onClick={onSettings} title="Settings">⚙</button>
    </header>
  );
}
