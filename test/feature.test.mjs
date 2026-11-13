// Feature tests for the import → store → auto-update pipeline.
//
// Runs in plain Node (no browser). IndexedDB is provided by fake-indexeddb;
// localStorage is a tiny in-memory shim. Only exercises code paths that don't
// hit the network: the IndexedDB primitives, the ingest seam, hydration, the
// throttle predicate, and read-state persistence.
//
//   npm test

// --- DOMParser for OPML parsing (plain Node has no DOM) ---
import 'fake-indexeddb/auto.js';
import { JSDOM } from 'jsdom';

// --- in-memory localStorage shim (store.js reads/writes it) ---
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { return this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
globalThis.localStorage = new MemStorage();
globalThis.DOMParser = new JSDOM().window.DOMParser;

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
const sync = await import('../src/lib/sync.js');
const refresh = await import('../src/lib/refresh.js');
const proxy = await import('../src/lib/proxy.js');
const { selectRow, buildList } = await import('../src/lib/view.js');

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

console.log('\nproxy: looksLikeXml rejects non-feed bodies');
ok(proxy.looksLikeXml('<?xml version="1.0"?><rss><channel/></rss>'), 'XML-declared RSS accepted');
ok(proxy.looksLikeXml('<rss version="2.0"><channel/></rss>'), 'declaration-less RSS accepted');
ok(proxy.looksLikeXml('<?xml?><feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>'), 'Atom accepted');
ok(proxy.looksLikeXml('\uFEFF  <feed></feed>'), 'BOM + whitespace tolerated');
ok(!proxy.looksLikeXml('Title: ITC.ua – …\nURL Source: …'), 'Jina reader markdown rejected');
ok(!proxy.looksLikeXml('<html><head><title>500 Internal Server Error</title></head></html>'), 'HTML error page rejected');
ok(!proxy.looksLikeXml(''), 'empty body rejected');

console.log('\nproxy: custom template maps ${url} (encoded)');
proxy.setUserProxy('https://proxy.example/fetch?url=${url}');
eq(proxy.getUserProxy(), 'https://proxy.example/fetch?url=${url}', 'template stored');
// Reproduce the mapping the fetch loop uses.
const mapped = proxy.getUserProxy().replace('${url}', encodeURIComponent('https://itc.ua/ua/feed/'));
eq(mapped, 'https://proxy.example/fetch?url=https%3A%2F%2Fitc.ua%2Fua%2Ffeed%2F', 'placeholder URL-encoded');
proxy.setUserProxy('');

console.log('\nselectRow — article stays visible after auto-mark-read');
// Simulates the Unread tab: list is unread-only, so marking the viewed article
// read removes it from `list`. selectRow must keep it (and its neighbors) shown.
const rows = (...keys) => keys.map((k) => ({ key: k }));
let ctx = selectRow(rows('A', 'B', 'C', 'D'), 'B', null);
eq([ctx.row.key, ctx.prev?.key, ctx.next?.key], ['B', 'A', 'C'], 'fresh selection captures neighbors');
ctx = selectRow(rows('A', 'C', 'D'), 'B', ctx); // B marked read -> gone from list
eq([ctx.row.key, ctx.prev?.key, ctx.next?.key], ['B', 'A', 'C'], 'selected-but-unlisted row kept with neighbors');
ctx = selectRow(rows('A', 'C', 'D'), 'C', ctx); // move to C (now listed)
eq([ctx.row.key, ctx.prev?.key, ctx.next?.key], ['C', 'A', 'D'], 'new selection re-captures neighbors');
ctx = selectRow(rows('A', 'D'), 'C', ctx); // C marked read -> gone
eq([ctx.row.key, ctx.prev?.key, ctx.next?.key], ['C', 'A', 'D'], 'C kept after leaving list');
eq(selectRow(rows('A', 'D'), null, ctx), null, 'no selection -> null');
eq(selectRow([], 'Z', null)?.row?.key ?? null, null, 'missing key -> null');

console.log('\nbuildList keepRead — driven-list mode keeps read items in Unread');
await store.ingestFeed('feed://k', makeFeed('feed://k', 3));
await store.setRead('feed://k::feed://k#1', true);
const st = store.getState();
const unreadView = { kind: 'unread', name: null };
const filtered = buildList(st, unreadView, '', false);
ok(!filtered.some((r) => r.key === 'feed://k::feed://k#1'), 'unread view drops the read item');
const kept = buildList(st, unreadView, '', true);
ok(kept.some((r) => r.key === 'feed://k::feed://k#1'), 'keepRead retains the read item');
eq(buildList(st, { kind: 'all', name: null }, '', false).length, buildList(st, { kind: 'all', name: null }, '', true).length, 'all view ignores keepRead');

console.log('\nmoveFeed — a feed dragged into a folder surfaces in that folder view');
await store.ingestFeed('feed://m1', makeFeed('feed://m1', 2));
await store.ingestFeed('feed://m2', makeFeed('feed://m2', 2));
store.createFolder('News');
eq(store.getState().feeds.find((f) => f.url === 'feed://m1').folder, '', 'new feed starts uncategorized');
store.moveFeed('feed://m1', 'News');
eq(store.getState().feeds.find((f) => f.url === 'feed://m1').folder, 'News', 'moveFeed sets the feed folder');
eq(store.getState().feeds.find((f) => f.url === 'feed://m2').folder, '', 'other feed stays uncategorized');
const st2 = store.getState();
const folderRows = buildList(st2, { kind: 'folder', name: 'News' }, '', false);
eq(folderRows.filter((r) => r.feedUrl === 'feed://m1').length, 2, 'folder view lists that feed items');
eq(folderRows.some((r) => r.feedUrl === 'feed://m2'), false, 'other feed excluded from the folder view');

console.log('\nsidebar grouping — feeds partition under their folder vs uncategorized');
{
  const feeds = store.getState().feeds;
  const inNews = feeds.filter((f) => f.folder === 'News');
  const uncategorized = feeds.filter((f) => !f.folder);
  eq(inNews.map((f) => f.url).sort(), ['feed://m1'], 'folder groups only its own feeds');
  eq(uncategorized.some((f) => f.url === 'feed://m2'), true, 'uncategorized list holds the uncategorized feed');
  eq(uncategorized.some((f) => f.url === 'feed://m1'), false, 'a grouped feed is not also uncategorized');
  eq(feeds.every((f) => f.folder === '' || f.folder === 'News'), true, 'every feed lands in exactly one group');
}

// A valid RSS 2.0 body the mocked fetch returns for a healthy feed.
const GOOD_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Good Feed</title><link>https://good.example</link><description>g</description>
  <item><title>g0</title><link>https://good.example?i=0</link><guid>https://good.example#0</guid><pubDate>${new Date().toUTCString()}</pubDate></item>
</channel></rss>`;

console.log('\nimportOPML — a broken (non-XML) feed is skipped, valid feeds still import');
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = String(input);
    // The Reddit-style feed that the proxy rendered as HTML (non-XML).
    if (u.includes('broken.example')) {
      return { ok: true, status: 200, text: async () => '<html><body>not a feed</body></html>' };
    }
    return { ok: true, status: 200, text: async () => GOOD_RSS };
  };
  const opml = `<?xml version="1.0"?>
<opml version="2.0"><body>
  <outline text="Tech"><outline xmlUrl="https://good.example/rss" text="Good"/></outline>
  <outline text="Misc"><outline xmlUrl="https://broken.example/rss" text="Broken"/></outline>
</body></opml>`;
  const r = await store.importOPML(opml);
  globalThis.fetch = realFetch;
  eq(r.count, 1, 'one valid feed added');
  eq(r.skipped, 1, 'one broken feed skipped');
  ok(store.getState().feeds.some((f) => f.url === 'https://good.example/rss'), 'valid feed subscribed');
  ok(!store.getState().feeds.some((f) => f.url === 'https://broken.example/rss'), 'broken feed not subscribed');
}

console.log('\nexportOPML — uncategorized feeds are included and round-trip through import');
{
  // Fresh import (mocked fetch) of an OPML with an uncategorized + a foldered feed.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => GOOD_RSS });
  const r = await store.importOPML(
    `<?xml version="1.0"?><opml version="2.0"><body>` +
      `<outline xmlUrl="https://uncat.example/rss" text="Uncat"/>` +
      `<outline text="News"><outline xmlUrl="https://cat.example/rss" text="Cat"/></outline>` +
      `</body></opml>`,
  );
  globalThis.fetch = realFetch;
  eq(r.count, 2, 'both feeds imported');
  const opml = store.exportOPML();
  ok(opml.includes('https://uncat.example/rss'), 'uncategorized feed exported flat');
  ok(opml.includes('https://cat.example/rss'), 'foldered feed exported');
  ok(opml.includes('<outline text="News"'), 'folder group exported');
  // Round-trip: re-import the export; both feeds survive with folders intact.
  await store.importOPML(opml);
  ok(
    store.getState().feeds.some((f) => f.url === 'https://uncat.example/rss' && !f.folder),
    'uncategorized feed survives round-trip uncategorized',
  );
  ok(
    store.getState().feeds.some((f) => f.url === 'https://cat.example/rss' && f.folder === 'News'),
    'foldered feed survives round-trip in its folder',
  );
}

console.log('\naddFeedFromBody — pasted raw XML subscribes with no network');
{
  // No network: if a fetch were attempted it would hit the real internet.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network should not be used'); };
  const body = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Pasted</title><link>https://pasted.example</link><description>p</description>
    <item><title>p0</title><link>https://pasted.example?i=0</link><guid>https://pasted.example#0</guid><pubDate>${new Date().toUTCString()}</pubDate></item>
  </channel></rss>`;
  await store.addFeedFromBody('pasted-feed:test', body, 'News');
  globalThis.fetch = realFetch;
  const f = store.getState().feeds.find((x) => x.url === 'pasted-feed:test');
  ok(f, 'pasted feed subscribed');
  eq(f.folder, 'News', 'pasted feed placed in folder');
  ok(f.title === 'Pasted', 'pasted feed title parsed');
  ok(store.getArticles('pasted-feed:test')?.items.length === 1, 'pasted feed item parsed');
}

// A fake Supabase client: records upserts and returns a canned cloud row.
// Mirrors exactly the chainable surface sync.js calls (from/select/eq/upsert/
// single/maybeSingle), so push/pull are exercised with no network.
function makeMockClient(cloudRow) {
  const rec = { lastPush: null };
  // The "table" object returned by from(): carries both select (pull) and
  // upsert (push), and upsert returns itself so .select().single() chains.
  const tableApi = {
    select() {
      return {
        eq: () => ({ maybeSingle: async () => ({ data: cloudRow ?? null }) }),
        single: async () => ({ data: rec.lastPush ?? {}, error: null }),
      };
    },
    upsert(row) {
      rec.lastPush = row;
      return tableApi;
    },
  };
  const api = {
    from() {
      return tableApi;
    },
    auth: { onAuthStateChange: () => () => {}, currentUser: null },
  };
  return { api, rec };
}

console.log('\nsync: mergeCloudState unions feeds/folders/read/saved');
{
  const local = {
    feeds: [{ url: 'local://a', title: 'Local A', folder: '', homePage: '', lastUpdated: '' }],
    folders: ['LocalF'],
    read: ['local://a::x'],
    saved: ['local://a::s'],
  };
  const cloud = {
    feeds: [
      { url: 'shared://z', title: 'Cloud Z', folder: '', homePage: '', lastUpdated: '' },
      { url: 'local://a', title: 'Cloud A-wins', folder: 'CloudF', homePage: '', lastUpdated: '' },
    ],
    folders: ['CloudF'],
    read: ['shared://z::y', 'local://a::x'],
    saved: ['shared://z::s'],
  };
  const m = sync.mergeCloudState(local, cloud);
  eq(m.feeds.map((f) => f.url).sort(), ['local://a', 'shared://z'], 'feeds unioned by url');
  eq(m.feeds.find((f) => f.url === 'local://a').title, 'Cloud A-wins', 'cloud feed wins on url conflict');
  eq(m.folders.sort(), ['CloudF', 'LocalF'], 'folders unioned');
  eq(m.read.sort(), ['local://a::x', 'shared://z::y'], 'read unioned');
  eq(m.saved.sort(), ['local://a::s', 'shared://z::s'], 'saved unioned');
}

console.log('\nsync: pushState upserts a user-scoped row; pullState reads it');
{
  const { api, rec } = makeMockClient({ feeds: ['cloud://x'], folders: ['CF'], read: ['cloud://x::1'], saved: [] });
  sync._setClientForTests(api, 'u1');
  const pulled = await sync.pullState();
  eq(pulled.feeds, ['cloud://x'], 'pullState returns the cloud row');
  await sync.pushState({ feeds: [{ url: 'local://y' }], folders: ['LF'], read: ['local://y::1'], saved: [] });
  ok(rec.lastPush, 'pushState wrote a row');
  eq(rec.lastPush.user_id, 'u1', 'row scoped to the signed-in user');
  eq(rec.lastPush.data.feeds[0].url, 'local://y', 'push payload carries feeds');
  ok(typeof rec.lastPush.updated_at === 'string', 'row carries updated_at');
}

console.log('\nsync: store.syncMerge unions cloud into local and writes it back');
{
  await store.startCloudSync();
  const cloudRow = {
    feeds: [{ url: 'cloud://news', title: 'Cloud News', folder: 'Tech', homePage: '', lastUpdated: '' }],
    folders: ['Tech'],
    read: ['cloud://news::c1'],
    saved: ['cloud://news::c1'],
  };
  const { api, rec } = makeMockClient(cloudRow);
  // Seed the user BEFORE any local mutation so persist() arms real pushes.
  sync._setClientForTests(api, 'user-1');

  // Local state that predates login.
  await store.ingestFeed('local://blog', makeFeed('local://blog', 2));
  store.createFolder('Blog');
  await store.setRead('local://blog::local://blog#0', true);

  await store.syncMerge();
  const st = store.getState();
  ok(st.feeds.some((f) => f.url === 'local://blog'), 'local feed preserved through merge');
  ok(st.feeds.some((f) => f.url === 'cloud://news'), 'cloud feed merged in');
  eq(st.folders.includes('Blog') && st.folders.includes('Tech'), true, 'folders unioned on merge');
  ok(
    st.read.has('local://blog::local://blog#0') && st.read.has('cloud://news::c1'),
    'read ids unioned on merge',
  );

  // Trailing debounced push writes the merged state back to the cloud.
  await new Promise((r) => setTimeout(r, 800));
  ok(rec.lastPush, 'merged state pushed back to the cloud');
  eq(rec.lastPush.user_id, 'user-1', 'push scoped to the signed-in user');
  ok(
    rec.lastPush.data.feeds.some((f) => f.url === 'local://blog') &&
      rec.lastPush.data.feeds.some((f) => f.url === 'cloud://news'),
    'push carries the unioned feeds',
  );
  ok(rec.lastPush.data.read.includes('cloud://news::c1'), 'push carries unioned read ids');
}

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
