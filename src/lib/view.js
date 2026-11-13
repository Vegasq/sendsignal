// view.js — pure functions that turn (state, view, search) into the article
// list and unread counts. Shared by ArticleList, Reader, and Sidebar so the
// three panes never disagree.

import { allArticles } from './store.js';

/**
 * Build the ordered list of rows for the current view.
 * @returns {Array<{key:string, item:object, feedUrl:string, isRead:boolean}>}
 */
export function buildList(state, view, search, keepRead = false) {
  const feeds = allArticles();
  const q = (search || '').toLowerCase().trim();
  const read = state.read;
  const saved = state.saved;

  // "Saved" is a synthetic view: rows whose key is bookmarked, regardless of
  // read state. Feeds dropped from the cache are naturally excluded, so a saved
  // key whose feed was unsubscribed simply stops listing.
  const isSavedView = view.kind === 'saved';
  const selectedUrls =
    view.kind === 'feed'
      ? [view.name]
      : view.kind === 'folder'
        ? feeds.filter((f) => folderOf(state, f.url) === view.name).map((f) => f.url)
        : feeds.map((f) => f.url);

  // Unread view drops read items by default; keepRead (driven-list mode) holds
  // them until you leave the tab, so reading one doesn't erase it mid-view.
  const onlyUnread = view.kind === 'unread';
  const rows = [];
  for (const feed of feeds.filter((f) => selectedUrls.includes(f.url))) {
    for (const item of feed.items) {
      const key = feed.url + '::' + item.id;
      const isRead = read.has(key);
      if (isSavedView && !saved.has(key)) continue;
      if (onlyUnread && isRead && !keepRead) continue;
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
 * Resolve which article a view should show for `selectedKey`, given the current
 * view list and the selection context carried over from the previous render.
 *
 * Auto-mark-read removes the viewed article from the unread-only list, so the
 * context must persist across renders: while an article is selected but no
 * longer in `list` (because it was just marked read), reuse its carried context
 * — row plus captured Previous/Next neighbors — so it stays on screen and
 * navigation keeps working. A fresh context is captured whenever the row is
 * still listed.
 *
 * @param {Array<{key:string}>} list
 * @param {string|null} selectedKey
 * @param {{row:Object, prev:Object|null, next:Object|null}|null} prev context from the last render
 * @returns {{row:Object, prev:Object|null, next:Object|null}|null}
 */
export function selectRow(list, selectedKey, prev) {
  const idx = selectedKey ? list.findIndex((r) => r.key === selectedKey) : -1;
  if (idx >= 0) {
    return { row: list[idx], prev: idx > 0 ? list[idx - 1] : null, next: idx < list.length - 1 ? list[idx + 1] : null };
  }
  if (prev && prev.row.key === selectedKey) return prev;
  return null;
}

/**
 * Unread counts keyed by feed url, plus synthetic keys "unread",
 * "folder::<name>", and "saved" (total bookmarked items) for the sidebar.
 */
export function unreadCounts(state) {
  const counts = {};
  let savedCount = 0;
  for (const feed of allArticles()) {
    let n = 0;
    for (const item of feed.items) {
      const key = feed.url + '::' + item.id;
      if (!state.read.has(key)) n++;
      if (state.saved.has(key)) savedCount++;
    }
    counts[feed.url] = n;
    const folder = folderOf(state, feed.url);
    if (folder) counts['folder::' + folder] = (counts['folder::' + folder] || 0) + n;
  }
  counts['saved'] = savedCount;
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
