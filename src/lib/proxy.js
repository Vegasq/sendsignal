// proxy.js — the single choke point for every outbound feed fetch.
//
// Browsers cannot fetch arbitrary feed URLs from a Pages-hosted SPA because the
// feed host will not send Access-Control-Allow-Origin. So we try the origin
// directly first, and only route through a list of CORS proxies when the origin
// blocks the cross-origin read. We try proxies in order until one returns a
// body that actually parses as a feed.
//
// The proxy list is data, not code: swap in a self-hosted proxy or a GitHub
// Actions worker later by editing PUBLIC_PROXIES below. The UI never changes.
//
// Two things make this robust instead of "first 200 wins":
//   - each entry can carry extra request headers (Jina needs X-Return-Format),
//   - a body is only accepted if it looks like XML (a 200 markdown/HTML error
//     page from a reader proxy must never masquerade as a feed).

/**
 * @typedef {Object} ProxyEntry
 * @property {(url: string) => string} map  -> proxied request URL
 * @property {Record<string,string>} [headers] -> extra request headers
 */

// allorigins `/raw` returns the body verbatim with permissive CORS. Jina is a
// reader service that returns markdown by default; X-Return-Format: html makes
// it return the page's raw markup, which for a feed URL is the feed XML.
const PUBLIC_PROXIES = [
  { map: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { map: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}` },
  { map: (url) => `https://r.jina.ai/${url}`, headers: { 'X-Return-Format': 'html' } },
];

/**
 * @typedef {Object} FetchResult
 * @property {string} body raw response body
 * @property {string} source the origin that succeeded (direct host or proxy)
 */

// A user-supplied proxy overrides the public list. Stored as a template string
// with a single ${url} placeholder, e.g. "https://myproxy.example/?url=". The
// placeholder is replaced with the URL-encoded feed URL.
let userProxy = '';

export function setUserProxy(template) {
  userProxy = (template || '').trim();
}

export function getUserProxy() {
  return userProxy;
}

const ACCEPT = 'application/xml,text/xml,text/plain,*/*';

/**
 * Heuristic: does this body look like a feed (RSS 2.0 / RDF/RSS 1.0 / Atom)?
 * Feeds may or may not carry an `<?xml` declaration, so we also accept the
 * root elements directly. Used to reject reader-proxy markdown and HTML errors.
 * @param {string} body
 */
export function looksLikeXml(body) {
  if (!body) return false;
  const head = body.replace(/^\uFEFF\s*/, '').slice(0, 32).toLowerCase();
  return (
    head.startsWith('<?xml') ||
    head.startsWith('<!doctype') ||
    head.startsWith('<rss') ||
    head.startsWith('<rdf') ||
    head.startsWith('<feed') ||
    head.startsWith('<atom')
  );
}

/**
 * Fetch a feed URL as text. Tries the origin directly first (no third party,
 * when the host permits cross-origin reads), then falls back to the proxy list
 * in order. A proxy only "succeeds" when it returns a non-empty body that looks
 * like XML; otherwise we move on.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<FetchResult>}
 */
export async function fetchFeedText(url, signal) {
  // 1. Direct. Works when the host sends Access-Control-Allow-Origin; many do.
  //    A CORS or network failure is swallowed — we fall back to proxies.
  try {
    const res = await fetchWithTimeout(url, signal, DIRECT_TIMEOUT_MS);
    if (res.ok) {
      const body = await res.text();
      if (body?.trim() && looksLikeXml(body)) {
        return { body, source: directSource(url) };
      }
    }
  } catch {
    // CORS block or timeout — fall through to proxies.
  }

  // 2. Proxies.
  const userEntry = userProxy
    ? [{ map: (u) => userProxy.replace('${url}', encodeURIComponent(u)) }]
    : [];
  const ordered = [...userEntry, ...PUBLIC_PROXIES];

  let lastError;
  for (const entry of ordered) {
    const proxied = entry.map(url);
    try {
      const res = await fetch(proxied, {
        signal,
        headers: { Accept: ACCEPT, ...(entry.headers || {}) },
      });
      if (!res.ok) {
        lastError = new Error(`Proxy ${short(proxied)} responded ${res.status}`);
        continue;
      }
      const body = await res.text();
      if (!body || !body.trim()) {
        lastError = new Error(`Proxy ${short(proxied)} returned an empty body`);
        continue;
      }
      if (!looksLikeXml(body)) {
        lastError = new Error(`Proxy ${short(proxied)} returned non-XML content`);
        continue;
      }
      return { body, source: short(proxied) };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All proxies failed');
}

const DIRECT_TIMEOUT_MS = 8000;

/**
 * fetch() with a hard timeout. Combines the caller's AbortSignal (lifecycle)
 * with a per-attempt timeout so a slow/hung origin can't stall a subscription.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @param {number} ms
 */
function fetchWithTimeout(url, signal, ms) {
  const ctrl = new AbortController();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function directSource(url) {
  try {
    const u = new URL(url);
    return `${u.hostname} (direct)`;
  } catch {
    return 'direct';
  }
}

function short(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.slice(0, 40);
  }
}
