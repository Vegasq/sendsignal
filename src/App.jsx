import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  subscribe,
  getState,
  setRead,
  markAllRead,
  setTheme,
  setUserProxy,
  setRefreshInterval,
  removeFeed,
  addFeed,
  moveFeed,
  hydrate,
} from './lib/store.js';
import * as refresh from './lib/refresh.js';
import { buildList, unreadCounts } from './lib/view.js';
import { timeAgo } from './lib/util.js';
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

  // Hydrate persisted articles, then begin periodic refresh. Re-fetch when the
  // tab becomes visible or is restored from cache so the inbox stays fresh.
  useEffect(() => {
    let mounted = true;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh.refreshAll({ force: false });
    };
    hydrate()
      .then(() => {
        if (!mounted) return;
        refresh.start();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onVisible);
      });
    return () => {
      mounted = false;
      refresh.stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, []);

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

  const handleRefresh = useCallback(() => {
    return refresh.refreshNow();
  }, []);

  return (
    <div className="app">
      <Header
        search={search}
        onSearch={setSearch}
        theme={state.theme}
        onToggleTheme={() => setTheme(state.theme === 'dark' ? 'light' : 'dark')}
        onSettings={() => setSettingsOpen(true)}
        refresh={state.refresh}
        onRefresh={handleRefresh}
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
          intervalMs={state.refresh.intervalMs}
          onSetInterval={(ms) => {
            setRefreshInterval(Number(ms));
            refresh.start(Number(ms));
          }}
        />
      )}
    </div>
  );
}

function Header({ search, onSearch, theme, onToggleTheme, onSettings, refresh, onRefresh }) {
  const running = Boolean(refresh?.running);
  const errCount = refresh ? Object.keys(refresh.errors || {}).length : 0;
  let title = 'Refresh now';
  if (running) title = 'Refreshing…';
  else if (refresh?.lastRun) title = `Last updated ${timeAgo(refresh.lastRun)}`;
  if (errCount) title += ` · ${errCount} error${errCount > 1 ? 's' : ''}`;

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
      <button
        className={"icon" + (running ? ' is-busy' : '')}
        onClick={onRefresh}
        title={title}
        disabled={running}
        aria-busy={running}
      >
        ⟳
      </button>
      <button className="icon" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <button className="icon" onClick={onSettings} title="Settings">⚙</button>
    </header>
  );
}
