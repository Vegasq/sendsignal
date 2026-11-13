// store.js — the app's single source of truth.
//
// Persisted (localStorage): feeds, folders, read/unread ids, theme, proxy.
// In-memory only (NOT persisted — exceeds the 5 MB localStorage cap): full
// article bodies, cached per feed URL.
//
// Components call subscribe() and read getState(); mutations go through the
// setters, which persist and then notify subscribers.

const KEY = 'sscc.v1';

/** @typedef {import('./feedParser').NormalizedFeed} NormalizedFeed */
import { parseFeed } from './feedParser.js';
import { saveFeed, loadAllFeeds, deleteFeed } from './db.js';

/**
 * @type {{feeds: Feed[], read: Set<string>, saved: Set<string>, theme: 'light'|'dark', proxy: string, folders: string[], refresh: RefreshStatus}}
 */
let state = {
  feeds: [],
  read: new Set(),
  saved: new Set(),
  theme: 'dark',
  proxy: '',
  folders: [],
  refresh: { lastRun: '', intervalMs: 30 * 60 * 1000, running: false, errors: {} },
};

/** @type {Map<string, NormalizedFeed>} feed url -> cached feed (bodies live here) */
const articleCache = new Map();

/** @type {Set<(s: AppState) => void>} */
const listeners = new Set();

/** @typedef {Object} Feed
 *  @property {string} id
 *  @property {string} url
 *  @property {string} title
 *  @property {string} folder
 *  @property {string} homePage
 *  @property {string} lastUpdated ISO string or '' */

/** @typedef {Object} AppState
 *  @property {Feed[]} feeds
 *  @property {Set<string>} read
 *  @property {Set<string>} saved
 *  @property {'light'|'dark'} theme
 *  @property {string} proxy
 *  @property {string[]} folders */

/** @typedef {Object} RefreshStatus
 *  @property {string} lastRun ISO time of last refresh tick, or ''
 *  @property {number} intervalMs ms between automatic refreshes
 *  @property {boolean} running
 *  @property {Record<string,string>} errors keyed by feed url */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.feeds = Array.isArray(data.feeds) ? data.feeds : [];
    state.read = new Set(Array.isArray(data.read) ? data.read : []);
    state.saved = new Set(Array.isArray(data.saved) ? data.saved : []);
    state.theme = data.theme === 'light' ? 'light' : 'dark';
    state.proxy = typeof data.proxy === 'string' ? data.proxy : '';
    state.folders = Array.isArray(data.folders) ? data.folders : [];
    // intervalMs is a preference (persisted); lastRun/errors are runtime only.
    state.refresh = {
      lastRun: '',
      intervalMs: typeof data.intervalMs === 'number' ? data.intervalMs : state.refresh.intervalMs,
      running: false,
      errors: {},
    };
    setUserProxy(state.proxy);
  } catch {
    /* corrupt storage: start fresh */
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      feeds: state.feeds,
      read: [...state.read],
      saved: [...state.saved],
      theme: state.theme,
      proxy: state.proxy,
      folders: state.folders,
      intervalMs: state.refresh.intervalMs,
    }));
  } catch (e) {
    // Storage full (e.g. huge read set) — read toggles simply won't persist.
    console.warn('persist failed', e);
  }
}

function notify() {
  for (const fn of listeners) fn(getState());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  // Folders come from explicit creation (persisted) and from feeds assigned to
  // a folder; union both so explicitly-created empty folders survive reloads and
  // feeds still surface their folder even if it was never created by name.
  const derived = [...new Set(state.feeds.map((f) => f.folder))].filter(Boolean);
  const folders = [...new Set([...state.folders, ...derived])].filter(Boolean).sort();
  return {
    feeds: state.feeds,
    read: state.read,
    saved: state.saved,
    theme: state.theme,
    proxy: state.proxy,
    folders,
    refresh: state.refresh,
  };
}

export function getArticles(feedUrl) {
  return articleCache.get(feedUrl) || null;
}

export function allArticles() {
  return [...articleCache.values()];
}

// --- mutations ---

export function setTheme(theme) {
  state.theme = theme;
  persist();
  notify();
}

export function setUserProxy(template) {
  state.proxy = template || '';
  // proxy.js keeps its own copy for fetch ordering.
  import('./proxy.js').then((m) => m.setUserProxy(template || ''));
  persist();
  notify();
}

function findFeed(url) {
  return state.feeds.find((f) => f.url === url);
}

/**
 * Publish a freshly parsed feed into the cache + IndexedDB + feed metadata.
 * Shared by addFeed and refreshFeed so persistence lives in exactly one place.
 * @param {string} url
 * @param {NormalizedFeed} normalized
 */
async function ingest(url, normalized) {
  const feed = findFeed(url);
  articleCache.set(url, normalized);
  if (feed) {
    if (normalized.title) feed.title = normalized.title.trim();
    if (normalized.homePage) feed.homePage = normalized.homePage.trim();
    feed.lastUpdated = new Date().toISOString();
  }
  await saveFeed({
    url,
    title: (normalized.title || '').trim(),
    homePage: (normalized.homePage || '').trim(),
    items: normalized.items,
  });
}

/**
 * Test seam: publish a parsed feed without any network. Persists to IndexedDB
 * and updates the in-memory cache + feed metadata.
 * @param {string} url
 * @param {NormalizedFeed} normalized
 */
export function ingestFeed(url, normalized) {
  const feed = findFeed(url);
  if (!feed) {
    state.feeds.push({
      id: 'f_' + shortId(url),
      url,
      title: (normalized.title || url).trim(),
      folder: '',
      homePage: (normalized.homePage || url).trim(),
      lastUpdated: new Date().toISOString(),
    });
  } else if (normalized.title) {
    feed.title = normalized.title.trim();
  }
  return ingest(url, normalized).then(() => {
    persist();
    notify();
  });
}

/**
 * Fetch, parse, and subscribe to a feed. Adds it to `folder` if new.
 * @param {string} url
 * @param {string} [folder]
 * @returns {Promise<Feed>}
 */
export async function addFeed(url, folder = '') {
  const normalized = url.trim();
  const existing = findFeed(normalized);
  if (existing) {
    if (folder && folder !== existing.folder) {
      existing.folder = folder;
      persist();
      notify();
    }
    return existing;
  }

  const { fetchFeedText } = await import('./proxy.js');
  const signal = new AbortController().signal;
  const { body } = await fetchFeedText(normalized, signal);
  const parsed = parseFeed(body, normalized);

  const feed = {
    id: 'f_' + shortId(normalized),
    url: normalized,
    title: parsed.title || normalized,
    folder,
    homePage: parsed.homePage || normalized,
    lastUpdated: '',
  };
  state.feeds.push(feed);
  await ingest(normalized, parsed);
  persist();
  notify();
  return feed;
}

/**
 * Subscribe to a feed from an already-fetched body (e.g. pasted XML) with no
 * network. Mirrors addFeed's push+ingest path but takes the body directly.
 * `url` is a synthetic key (pasted feeds have no origin URL).
 * @param {string} url synthetic url key
 * @param {string} body raw feed XML
 * @param {string} [folder]
 * @returns {Promise<Feed>}
 */
export async function addFeedFromBody(url, body, folder = '') {
  const normalized = parseFeed(body, url);
  const feed = {
    id: 'f_' + shortId(url),
    url,
    title: normalized.title || url,
    folder,
    homePage: normalized.homePage || url,
    lastUpdated: '',
  };
  state.feeds.push(feed);
  await ingest(url, normalized);
  persist();
  notify();
  return feed;
}

/**
 * Re-fetch an existing feed and refresh its cached items.
 * @param {string} feedUrl
 */
export async function refreshFeed(feedUrl) {
  const feed = findFeed(feedUrl);
  if (!feed) return;
  const { fetchFeedText } = await import('./proxy.js');
  const { body } = await fetchFeedText(feedUrl, new AbortController().signal);
  const parsed = parseFeed(body, feedUrl);
  await ingest(feedUrl, parsed);
  persist();
  notify();
}

/**
 * Hydrate the in-memory article cache from IndexedDB. Called once at startup so
 * article bodies survive reloads. Non-fatal if IndexedDB is unavailable.
 * @returns {Promise<number>} number of feeds restored
 */
export async function hydrate() {
  try {
    const feeds = await loadAllFeeds();
    for (const f of feeds) articleCache.set(f.url, f);
    return feeds.length;
  } catch (e) {
    console.warn('hydrate failed', e);
    return 0;
  }
}

export function setRead(id, isRead) {
  if (isRead) state.read.add(id);
  else state.read.delete(id);
  persist();
  notify();
}

/** Bookmark an item (row key) as saved. Persisted so Saved survives reloads. */
export function setSaved(id, saved) {
  if (saved) state.saved.add(id);
  else state.saved.delete(id);
  persist();
  notify();
}

export function markAllRead(target) {
  const feeds =
    target === 'all'
      ? allArticles()
      : Array.isArray(target)
        ? allArticles().filter((f) => target.includes(f.url))
        : allArticles().filter((f) => f.url === target);
  for (const feed of feeds) {
    for (const item of feed.items) state.read.add(feed.url + '::' + item.id);
  }
  persist();
  notify();
}

export function moveFeed(feedUrl, folder) {
  const feed = findFeed(feedUrl);
  if (feed) {
    feed.folder = folder;
    persist();
    notify();
  }
}

/** Create a (possibly empty) folder by name. Idempotent; trims whitespace. */
export function createFolder(name) {
  const n = (name || '').trim();
  if (!n || state.folders.includes(n)) return;
  state.folders.push(n);
  persist();
  notify();
}

export function removeFeed(feedUrl) {
  state.feeds = state.feeds.filter((f) => f.url !== feedUrl);
  articleCache.delete(feedUrl);
  persist();
  // Persisted bodies are orphaned; drop them. Non-fatal if unavailable.
  deleteFeed(feedUrl).catch((e) => console.warn('deleteFeed failed', e));
  notify();
}

/**
 * Set the automatic refresh interval (ms). Restarts any running scheduler.
 * @param {number} ms
 */
export function setRefreshInterval(ms) {
  state.refresh.intervalMs = Number.isFinite(ms) && ms > 0 ? ms : state.refresh.intervalMs;
  persist();
  notify();
}

/**
 * Merge partial refresh status (lastRun/running/errors) and notify. The
 * interval preference is persisted separately via setRefreshInterval.
 * @param {Partial<RefreshStatus>} partial
 */
export function setRefreshStatus(partial) {
  state.refresh = { ...state.refresh, ...partial };
  notify();
}

// --- OPML ---

export function exportOPML() {
  const groups = {};
  const uncategorized = [];
  for (const f of state.feeds) {
    if (f.folder) (groups[f.folder] ||= []).push(f);
    else uncategorized.push(f);
  }

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '<head><title>sscc subscriptions</title></head>',
    '<body>',
  ];
  // Uncategorized feeds render flat, directly under <body>, so they re-import
  // with folder "" (their <body> parent has no text/title). Previously feeds
  // with no folder were dropped from export entirely — data loss on re-import.
  for (const f of uncategorized) {
    parts.push(
      `<outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" ` +
        `xmlUrl="${esc(f.url)}" htmlUrl="${esc(f.homePage)}" />`,
    );
  }
  for (const folder of Object.keys(groups).sort()) {
    parts.push(`<outline text="${esc(folder)}" title="${esc(folder)}">`);
    for (const f of groups[folder]) {
      parts.push(
        `<outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" ` +
          `xmlUrl="${esc(f.url)}" htmlUrl="${esc(f.homePage)}" />`,
      );
    }
    parts.push('</outline>');
  }
  parts.push('</body></opml>');
  return parts.join('\n');
}

/**
 * Import OPML text. Adds any feeds not already subscribed.
 * @param {string} text
 * @returns {{added:number, skipped:number, folders:string[]}}
 */
export async function importOPML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error('Malformed OPML');

  const added = { count: 0, skipped: 0, folders: [] };
  // <outline> with xmlUrl is a feed; outline with nested outlines is a folder.
  const feeds = Array.from(doc.querySelectorAll('outline'));
  for (const el of feeds) {
    const xmlUrl = el.getAttribute('xmlUrl');
    if (!xmlUrl) continue;
    const folder = (el.parentElement?.getAttribute('text') ||
      el.parentElement?.getAttribute('title') ||
      '').trim();
    if (folder && !added.folders.includes(folder)) added.folders.push(folder);
    if (findFeed(xmlUrl)) {
      added.skipped++;
      continue;
    }
    try {
      await addFeed(xmlUrl, folder);
      added.count++;
    } catch {
      // Broken import (e.g. a proxy returned non-XML content): skip this feed
      // and continue with the rest of the OPML rather than aborting the batch.
      added.skipped++;
    }
  }
  return added;
}

// --- helpers ---

function namespace(itemId, feedUrl) {
  return feedUrl + '::' + itemId;
}

export function unnamespace(id) {
  const i = id.indexOf('::');
  return i === -1 ? id : id.slice(i + 2);
}

function shortId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

load();
hydrate();
notify();
