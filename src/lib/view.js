// view.js — pure functions that turn (state, view, search) into the article
// list and unread counts. Shared by ArticleList, Reader, and Sidebar so the
// three panes never disagree.

import { allArticles } from './store.js';

/**
 * Build the ordered list of rows for the current view.
 * @returns {Array<{key:string, item:object, feedUrl:string, isRead:boolean}>}
 */
export function buildList(state, view, search) {
  const feeds = allArticles();
  const q = (search || '').toLowerCase().trim();
  const read = state.read;

  const selectedUrls =
    view.kind === 'feed'
      ? [view.name]
      : view.kind === 'folder'
        ? feeds.filter((f) => folderOf(state, f.url) === view.name).map((f) => f.url)
        : feeds.map((f) => f.url);

  const onlyUnread = view.kind === 'unread';
  const rows = [];
  for (const feed of feeds.filter((f) => selectedUrls.includes(f.url))) {
    for (const item of feed.items) {
      const key = feed.url + '::' + item.id;
      const isRead = read.has(key);
      if (onlyUnread && isRead) continue;
      if (q) {
        const hay = (item.title + ' ' + item.author + ' ' + plain(item.content)).toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push({ key, item, feedUrl: feed.url, isRead });
    }
  }
  rows.sort((a, b) => (b.item.published || '').localeCompare(a.item.published || ''));
  return rows;
}

/**
 * Unread counts keyed by feed url, plus synthetic keys "unread" and
 * "folder::<name>" for the sidebar aggregates.
 */
export function unreadCounts(state) {
  const counts = {};
  for (const feed of allArticles()) {
    let n = 0;
    for (const item of feed.items) {
      if (!state.read.has(feed.url + '::' + item.id)) n++;
    }
    counts[feed.url] = n;
    const folder = folderOf(state, feed.url);
    if (folder) counts['folder::' + folder] = (counts['folder::' + folder] || 0) + n;
  }
  return counts;
}

function folderOf(state, url) {
  return state.feeds.find((f) => f.url === url)?.folder || '';
}

function plain(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ');
}
