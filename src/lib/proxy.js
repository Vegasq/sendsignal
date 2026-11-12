// proxy.js — the single choke point for every outbound feed fetch.
//
// Browsers cannot fetch arbitrary feed URLs from a Pages-hosted SPA because the
// feed host will not send Access-Control-Allow-Origin. We route every request
// through a list of CORS proxies and try them in order until one succeeds.
//
// The list is data, not code: swap in a self-hosted proxy or a GitHub Actions
// worker later by editing PROXIES below. The UI never needs to change.

/**
 * @typedef {(url: string) => string} ProxyMapper
 */

// Each entry maps a raw feed URL to a proxied URL that returns CORS headers.
// allorigins `/raw` returns the body verbatim with permissive CORS.
const PUBLIC_PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://r.jina.ai/${url}`,
];

/**
 * @typedef {Object} FetchResult
 * @property {string} body raw response body
 * @property {string} source the proxy that succeeded (for diagnostics)
 */

// A user-supplied proxy overrides the public list. Stored as a template string
// with a single ${url} placeholder, e.g. "https://myproxy.example/?url=".
let userProxy = '';

export function setUserProxy(template) {
  userProxy = (template || '').trim();
}

export function getUserProxy() {
  return userProxy;
}

/**
 * Fetch a feed URL as text, trying proxies in order.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<FetchResult>}
 */
export async function fetchFeedText(url, signal) {
  const ordered = userProxy ? [userProxy, ...PUBLIC_PROXIES] : PUBLIC_PROXIES;

  let lastError;
  for (const map of ordered) {
    const proxied = map(url);
    try {
      const res = await fetch(proxied, { signal, headers: { Accept: 'application/xml,text/xml,text/plain,*/*' } });
      if (!res.ok) {
        lastError = new Error(`Proxy ${short(proxied)} responded ${res.status}`);
        continue;
      }
      const body = await res.text();
      if (!body || !body.trim()) {
        lastError = new Error(`Proxy ${short(proxied)} returned an empty body`);
        continue;
      }
      return { body, source: short(proxied) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All proxies failed');
}

function short(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.slice(0, 40);
  }
}
