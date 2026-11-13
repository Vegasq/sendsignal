import { memo } from 'react';
import { allArticles, setSaved } from '../lib/store.js';
import { buildList } from '../lib/view.js';
import { timeAgo, snippet } from '../lib/util.js';

export default memo(function ArticleList({ state, view, search, keepRead, onSelect, onMarkAllRead, onSave }) {
  const items = buildList(state, view, search, keepRead);

  if (items.length === 0) {
    return (
      <div className="articles">
        <div className="empty-state">
          {allArticles().length === 0
            ? 'Subscribe to a feed to get started.'
            : view.kind === 'saved'
              ? 'No saved articles yet. ★ an article to keep it here.'
              : 'No articles match.'}
        </div>
      </div>
    );
  }

  return (
    <div className="articles">
      <div className="articles-header">
        <h2>{headerTitle(state, view)}</h2>
        <button onClick={() => onMarkAllRead(view)}>Mark all read</button>
      </div>
      {items.map((it) => (
        <ArticleRow
          key={it.key}
          row={it}
          feedTitle={feedTitle(state, it.feedUrl)}
          isSaved={Boolean(state.saved && state.saved.has(it.key))}
          onSelect={onSelect}
          onSave={onSave}
        />
      ))}
    </div>
  );
});

function feedTitle(state, url) {
  return state.feeds.find((f) => f.url === url)?.title || url;
}

function headerTitle(state, view) {
  if (view.kind === 'feed') return state.feeds.find((f) => f.url === view.name)?.title || view.name;
  if (view.kind === 'folder') return view.name;
  if (view.kind === 'saved') return 'Saved';
  if (view.kind === 'unread') return 'Unread';
  return 'All items';
}

function ArticleRow({ row, feedTitle, isSaved, onSelect, onSave }) {
  const { item, isRead } = row;
  return (
    <div className={"article" + (isRead ? '' : ' unread')} onMouseDown={() => onSelect(row)}>
      <button
        className="star"
        title={isSaved ? 'Unsave this article' : 'Save this article'}
        aria-pressed={isSaved}
        onClick={(e) => { e.stopPropagation(); onSave(row.key, !isSaved); }}>
        {isSaved ? '★' : '☆'}
      </button>
      <div className="title">{item.title}</div>
      <div className="meta">
        <span>{feedTitle}</span>
        <span>·</span>
        <span>{timeAgo(item.published)}</span>
        {item.author && <span>· {item.author}</span>}
      </div>
      {!isRead && snippet(item.content) && <div className="snippet">{snippet(item.content)}</div>}
    </div>
  );
}
