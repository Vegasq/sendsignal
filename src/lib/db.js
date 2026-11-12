// db.js — IndexedDB persistence for full article bodies.
//
// Lightweight metadata (feeds/folders/read/theme/proxy) stays in localStorage;
// full article HTML routinely blows past its ~5 MB cap, so bodies live here.
// IndexedDB stores structured objects and is effectively unbounded for our
// needs. This module touches only `indexedDB`, so it is unit-testable in Node
// with a fake-indexeddb shim (no DOM required).

const DB_NAME = 'sscc-db';
const DB_VERSION = 1;
const STORE = 'feeds';

/** Default number of items kept per feed. Feeds are ordered newest-first, so
 *  this drops the oldest entries. Overridable for tests via setItemCap(). */
let ITEM_CAP = 100;

/** @typedef {import('./feedParser').NormalizedFeed} NormalizedFeed */

/** @typedef {Object} StoredFeed
 *  @property {string} url
 *  @property {string} title
 *  @property {string} homePage
 *  @property {import('./feedParser').NormalizedItem[]} items
 *  @property {string} updated ISO time last persisted */

let dbPromise = null;

function connect() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'url' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => console.warn(`IndexedDB ${DB_NAME} blocked by another tab`);
    });
  }
  return dbPromise;
}

/** Override the per-feed item cap (tests only). */
export function setItemCap(n) {
  ITEM_CAP = n;
}

/** Keep the newest `cap` items; feeds are ordered newest-first. */
export function capItems(items, cap = ITEM_CAP) {
  if (!Array.isArray(items)) return [];
  return items.length > cap ? items.slice(0, cap) : items;
}

/**
 * Persist a feed's items. Replacing an existing key overwrites it.
 * @param {NormalizedFeed} feed
 */
export function saveFeed(feed) {
  const payload = {
    url: feed.url,
    title: (feed.title || '').trim(),
    homePage: (feed.homePage || '').trim(),
    items: capItems(feed.items),
    updated: new Date().toISOString(),
  };
  return connect().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

/** Load every persisted feed. Returns [] when the store is empty or unavailable. */
export function loadAllFeeds() {
  return connect().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
  });
}

/** Remove a feed's persisted items (e.g. on unsubscribe). */
export function deleteFeed(url) {
  return connect().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}
