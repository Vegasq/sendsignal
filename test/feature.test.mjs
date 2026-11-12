// Feature tests for the import → store → auto-update pipeline.
//
// Runs in plain Node (no browser). IndexedDB is provided by fake-indexeddb;
// localStorage is a tiny in-memory shim. Only exercises code paths that don't
// hit the network: the IndexedDB primitives, the ingest seam, hydration, the
// throttle predicate, and read-state persistence.
//
//   npm test

import 'fake-indexeddb/auto.js';

// --- in-memory localStorage shim (store.js reads/writes it) ---
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
globalThis.localStorage = new MemStorage();

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log('  ✓', msg); }
  else { failures++; console.error('  ✗', msg); }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} [got ${JSON.stringify(a)}, want ${JSON.stringify(b)}]`);
}

const db = await import('../src/lib/db.js');
const store = await import('../src/lib/store.js');
const refresh = await import('../src/lib/refresh.js');

function makeFeed(url, n) {
  return {
    url,
    title: 'Test ' + url.split('://')[1].toUpperCase(),
    homePage: url,
    items: Array.from({ length: n }, (_, i) => ({
      id: `${url}#${i}`,
      title: `${url} item ${i}`,
      link: `${url}?i=${i}`,
      published: new Date(Date.now() - i * 3600_000).toISOString(),
      author: 'test',
      content: `<p>${url} body ${i}</p>`,
      source: 'item',
    })),
  };
}

console.log('\ndb.js round-trip + cap');
db.setItemCap(100);
await db.saveFeed(makeFeed('db://rt', 150));
let all = await db.loadAllFeeds();
eq(all.length, 1, 'one feed stored');
eq(all[0].items.length, 100, 'items capped to 100 (newest kept)');
ok(all[0].items[0].id === 'db://rt#0', 'newest-first ordering preserved');
await db.deleteFeed('db://rt');
all = await db.loadAllFeeds();
eq(all.length, 0, 'deleteFeed removes the feed');

console.log('\ningestFeed persists + caches');
await store.ingestFeed('feed://a', makeFeed('feed://a', 3));
all = await db.loadAllFeeds();
eq(all.find((f) => f.url === 'feed://a').items.length, 3, 'ingested feed written to IndexedDB');
eq(store.allArticles().filter((f) => f.url === 'feed://a').length, 1, 'ingested feed in in-memory cache');
eq(store.getState().feeds.find((f) => f.url === 'feed://a').title, 'Test A', 'feed metadata populated');

console.log('\nhydration across reload');
// A fresh module instance has an empty cache but shares the same IndexedDB.
const store2 = await import('../src/lib/store.js?fresh=' + Date.now());
const restored = await store2.hydrate();
eq(restored, 1, 'hydrate restored 1 feed from IndexedDB');
eq(store2.allArticles().some((f) => f.url === 'feed://a'), true, 'cached feed survived the reload');

console.log('\nthrottle predicate (shouldRefresh)');
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
ok(refresh.shouldRefresh({ lastUpdated: '' }) === true, 'no lastUpdated => due');
ok(refresh.shouldRefresh({ lastUpdated: ago(120) }) === true, 'refreshed 2h ago => due');
ok(refresh.shouldRefresh({ lastUpdated: ago(5) }) === false, 'refreshed 5m ago => not due (within 15m window)');
ok(refresh.shouldRefresh({ lastUpdated: ago(20) }) === true, 'refreshed 20m ago => due');
ok(refresh.shouldRefresh(null) === true, 'null feed => due');

console.log('\nread-state persistence');
await store.setRead('feed://a::feed://a#1', true);
const saved = JSON.parse(localStorage.getItem('sscc.v1'));
ok(saved.read.includes('feed://a::feed://a#1'), 'read id persisted to localStorage');
eq(store.getState().read.has('feed://a::feed://a#1'), true, 'read id live in current session');

console.log('\nrefresh scheduler (no network path)');
eq(refresh.isRunning(), false, 'scheduler off by default');
const ms = refresh.start();
ok(refresh.isRunning() === true, 'start() arms the scheduler');
refresh.stop();
ok(refresh.isRunning() === false, 'stop() disarms it');
eq(typeof ms, 'number', 'start() returns the interval in ms');
const r = await refresh.refreshAll({});
eq(r, { refreshed: 0, errors: 0 }, 'refreshAll with no feeds returns zeroed result');
ok(Boolean(store.getState().refresh.lastRun), 'refreshAll records lastRun in status');

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
