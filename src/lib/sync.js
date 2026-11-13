// sync.js — Supabase-backed persistence for the app's *lightweight* state.
//
// Article bodies stay in IndexedDB (db.js): they are large, per-device, and
// re-fetchable through the proxy. What needs to survive across devices is the
// small metadata that defines your library — feeds, folders, read ids, saved
// ids. That is what syncs here.
//
// Design:
//   - The Supabase client is created lazily in initSupabase() from Vite env
//     vars, so importing this module (e.g. in the Node test suite) never touches
//     import.meta.env or opens a network connection.
//   - All writes are scoped to the signed-in user via a row-per-user table with
//     row-level security (see supabase/migrations/20261113000000_init_profiles.sql
//     and 20261113000001_enable_rls_profiles.sql). The anon key is safe to ship
//     in the bundle because RLS, not the key, enforces isolation.
//   - mergeCloudState() is a pure function so the merge policy is unit-testable
//     with no client, no network, no DOM.

import { createClient } from '@supabase/supabase-js';

const TABLE = 'profiles';

/** @typedef {Object} SyncData
 *  @property {import('./store').Feed[]} feeds
 *  @property {string[]} folders
 *  @property {string[]} read
 *  @property {string[]} saved */

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null;

/** Current signed-in user id, or null when signed out. Driven by auth events. */
let userId = null;

/** @type {Set<(uid: string|null) => void>} */
const listeners = new Set();

/**
 * Create (once) the Supabase client from Vite env vars. Idempotent. Returns the
 * client, or null when the env vars are absent (sync simply stays disabled and
 * the app keeps running as a pure local, no-backend reader).
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function initSupabase() {
  const url = import.meta.env?.VITE_SUPABASE_URL;
  const anon = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.warn(
      'sync: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — ' +
        'cloud sync is disabled (the app still works locally).',
    );
    return null;
  }
  if (client) return client;

  client = createClient(url, anon, {
    auth: {
      persistAuthToLocalStorage: true,
      persistSession: true,
      storageKey: 'sscc.supabase.session',
      // Don't let the OAuth redirect loop get confused by the Pages SPA router.
      flowType: 'pkce',
    },
  });

  // Drive `userId` from auth state. onAuthStateChange also fires once on
  // subscribe with the current session, so a persisted login is picked up
  // immediately on load.
  client.auth.onAuthStateChange((_event, session) => {
    userId = session?.user?.id ?? null;
    for (const fn of listeners) fn(userId);
  });

  return client;
}

/** The signed-in user id, or null. Safe to call before initSupabase(). */
export function getCurrentUserId() {
  return userId;
}

/** True when a Supabase client exists AND a user is signed in. */
export function isSyncEnabled() {
  return Boolean(client && userId);
}

/** Subscribe to signed-in user id changes. Returns an unsubscribe fn. */
export function onUserId(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Sign in with Google. Redirects to Google and back to this page; the auth
 * listener then fires and the store merges the cloud state in.
 */
export async function signInWithGoogle() {
  const c = initSupabase();
  if (!c) throw new Error('Supabase is not configured');
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: {
      flowType: 'pkce',
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    },
  });
  if (error) throw error;
}

/** Sign out. Local state is kept, so switching accounts is lossless. */
export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
}

/**
 * Upsert the user's lightweight state. No-op when signed out. The payload is
 * the exact shape the store persists to localStorage.
 * @param {SyncData} data
 */
export async function pushState(data) {
  if (!client || !userId) return;
  const feedCount = Array.isArray(data?.feeds) ? data.feeds.length : 0;
  const { error } = await client
    .from(TABLE)
    .upsert({ user_id: userId, data, updated_at: new Date().toISOString() })
    .select('user_id')
    .single();
  if (error) {
    console.warn('sync: push failed', error);
  } else {
    // DIAGNOSTIC (remove after cross-sync debug): report what actually reached the cloud.
    console.log(`sync:push ok user=${userId} feeds=${feedCount}`);
  }
}

/**
 * Fetch the user's lightweight state. Returns {} when signed out or when no row
 * exists yet.
 * @returns {Promise<Partial<SyncData>>}
 */
export async function pullState() {
  if (!client || !userId) return {};
  const { data, error } = await client
    .from(TABLE)
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('sync: pull failed', error);
    return {};
  }
  // DIAGNOSTIC (remove after cross-sync debug): report what the cloud actually returned.
  const feedCount = data && Array.isArray(data.feeds) ? data.feeds.length : 0;
  console.log(`sync:pull ${data ? 'row' : 'none'} user=${userId} feeds=${feedCount}`);
  return data ?? {};
}

/**
 * Merge cloud state into local state. Pure, so the policy is testable in
 * isolation. Rules:
 *   - feeds: union by url; the cloud copy wins on a url conflict (the cloud is
 *     the authoritative library), but feeds that exist only locally are kept so
 *     nothing added just before login is lost.
 *   - folders / read / saved: union (order-insensitive). For read/saved this is
 *     the least-surprising behaviour — an item marked read on one device shows
 *     as read everywhere.
 * @param {{feeds: import('./store').Feed[], folders: string[], read: string[], saved: string[]}} local
 * @param {{feeds?: unknown[], folders?: unknown[], read?: unknown[], saved?: unknown[]}} cloud
 * @returns {{feeds: import('./store').Feed[], folders: string[], read: string[], saved: string[]}}
 */
export function mergeCloudState(local, cloud) {
  const cloudFeeds = Array.isArray(cloud?.feeds) ? cloud.feeds : [];
  const feedByUrl = new Map();
  for (const f of local.feeds || []) feedByUrl.set(f.url, f);
  for (const f of cloudFeeds) feedByUrl.set(f.url, f); // cloud wins on conflict

  const folders = union((local.folders || []).filter(Boolean), (cloud.folders || []));
  const read = union((local.read || []), (cloud.read || []));
  const saved = union((local.saved || []), (cloud.saved || []));

  return { feeds: [...feedByUrl.values()], folders, read, saved };
}

/** Order-insensitive union of two arrays, de-duplicated. */
function union(a, b) {
  return [...new Set([...a, ...b])];
}

/**
 * Test seam: install a fake client + user id without any network. The fake
 * client only needs `from()`, `auth.onAuthStateChange`, and the chainable
 * `select`/`eq`/`upsert`/`single`/`maybeSingle` methods the module calls.
 * Also seeds `userId` and notifies listeners, so store wiring (startCloudSync)
 * reacts exactly as it would to a real auth event.
 * @param {any} c
 * @param {string} uid
 */
export function _setClientForTests(c, uid) {
  client = c;
  userId = uid;
  for (const fn of listeners) fn(uid);
}
