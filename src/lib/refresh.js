// refresh.js — periodic, throttled refresh of subscribed feeds.
//
// The page is the only "process" we have (no backend, no long-lived worker by
// default). While the tab is open we re-fetch feeds on an interval and when the
// user returns to the tab; feeds refreshed recently are skipped to avoid
// hammering the proxy. A manual "Refresh now" bypasses the throttle.
//
// Status (lastRun, intervalMs, running, per-feed errors) lives in store.js so
// the UI can render it.

import { getState, refreshFeed, setRefreshStatus } from './store.js';

// Skip a feed unless it hasn't been refreshed within this window (unless forced).
export const MIN_FEED_AGE_MS = 15 * 60 * 1000;

let timer = null;

/**
 * Decide whether a feed is due for refresh at time `now`.
 * Pure, so it is trivially testable.
 * @param {import('./store').Feed|null} feed
 * @param {number} [now]
 */
export function shouldRefresh(feed, now = Date.now()) {
  if (!feed || !feed.lastUpdated) return true;
  const t = new Date(feed.lastUpdated).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > MIN_FEED_AGE_MS;
}

/**
 * Refresh every due feed. With `force`, refresh all regardless of throttle.
 * Per-feed errors are recorded, never thrown.
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{refreshed:number, errors:number}>}
 */
export async function refreshAll({ force = false } = {}) {
  const st = getState();
  setRefreshStatus({ running: true });
  const now = Date.now();

  const errors = { ...st.refresh.errors };
  let refreshed = 0;

  await Promise.all(
    st.feeds.map(async (feed) => {
      if (!force && !shouldRefresh(feed, now)) return;
      try {
        await refreshFeed(feed.url);
        refreshed++;
        delete errors[feed.url];
      } catch (e) {
        errors[feed.url] = e.message || String(e);
      }
    }),
  );

  setRefreshStatus({ running: false, lastRun: new Date().toISOString(), errors });
  return { refreshed, errors: Object.keys(errors).length };
}

/** Start the interval scheduler. Returns the effective interval in ms. */
export function start(intervalMs) {
  stop();
  const ms = intervalMs || getState().refresh.intervalMs;
  timer = setInterval(() => {
    refreshAll({ force: false }).catch((e) => console.warn('refresh tick failed', e));
  }, ms);
  return ms;
}

/** Stop the interval scheduler. */
export function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Force an immediate refresh of every feed. */
export function refreshNow() {
  return refreshAll({ force: true });
}

/** Whether the scheduler is currently armed. */
export function isRunning() {
  return timer !== null;
}

export default { start, stop, refreshNow, refreshAll, shouldRefresh, isRunning };
