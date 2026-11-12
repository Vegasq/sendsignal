// feedParser.js — normalize RSS 2.0 / Atom / RDF(RSS 1.0) into a common shape.
//
// Parsing is done with the browser's DOMParser (no dependency). The three feed
// dialects differ in root element, container, and field names; this module
// collapses them into:
//
//   { url, title, homePage?, items: [ { id, title, link, published, author,
//       content, source } ] }

/**
 * @typedef {Object} NormalizedItem
 * @property {string} id
 * @property {string} title
 * @property {string} link
 * @property {string} published ISO date string (or '')
 * @property {string} author
 * @property {string} content HTML
 * @property {string} source description of origin for debugging
 */

/**
 * @typedef {Object} NormalizedFeed
 * @property {string} url
 * @property {string} title
 * @property {string} homePage
 * @property {NormalizedItem[]} items
 */

/**
 * Parse XML text into a NormalizedFeed.
 * @param {string} xml
 * @param {string} feedUrl
 * @returns {NormalizedFeed}
 */
export function parseFeed(xml, feedUrl) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('Malformed XML: ' + parseErr.textContent.slice(0, 120));
  }

  const root = doc.documentElement;
  const rootName = (root.localName || root.tagName).toLowerCase();

  let title = '';
  let homePage = '';
  let itemNodes = [];

  if (rootName === 'rss' || rootName === 'rdf') {
    // RSS 2.0 and RDF/RSS 1.0: metadata under <channel>, items as siblings.
    const channel = root.querySelector('channel') || firstByLocalName(root, ['channel']);
    title = textOf(childByLocalName(channel, ['title', 'feedTitle'])) || feedUrl;
    homePage = linkOf(childByLocalName(channel, ['link'])) || '';
    itemNodes = Array.from(root.querySelectorAll('item'));
  } else if (rootName === 'feed') {
    // Atom.
    title = textOf(childByLocalName(root, ['title'])) || feedUrl;
    homePage = atomHomeLink(root) || '';
    itemNodes = Array.from(root.querySelectorAll('entry'));
  } else {
    throw new Error('Unrecognized feed format (root <' + rootName + '>)');
  }

  const items = itemNodes.map((node, i) => parseItem(node, `${feedUrl}#${i}`));

  return { url: feedUrl, title: title.trim(), homePage: homePage.trim(), items };
}

function parseItem(node, fallbackId) {
  const title = textOf(childByLocalName(node, ['title'])) || '(untitled)';
  const link = atomLink(node) || linkOf(childByLocalName(node, ['link'])) || '';
  const id = atomId(node) || guidOf(childByLocalName(node, ['guid'])) || link || fallbackId;
  const author =
    atomAuthor(node) ||
    textOf(childByLocalName(node, ['creator', 'author'])) ||
    '';
  const published =
    dateOf(childByLocalName(node, ['updated', 'published', 'date', 'pubDate'])) || '';
  const content =
    htmlOf(childByLocalName(node, ['content', 'encoded'])) ||
    htmlOf(childByLocalName(node, ['summary', 'description'])) ||
    '';

  return {
    id,
    title: title.trim(),
    link: link.trim(),
    published,
    author: author.trim(),
    content,
    source: node.localName || node.tagName.toLowerCase(),
  };
}

// --- field accessors (namespace-tolerant via localName matching) ---

// Return the first descendant whose localName matches one of `names`, so
// `<content:encoded>` and `<dc:date>` resolve the same as their un-namespaced
// forms. Uses a manual pre-order walk on `localName` rather than
// `getElementsByTagNameNS('*')`, which some engines (happy-dom) return empty
// for on no-namespace elements, and rather than `querySelector('*[local-name()..]')`,
// which is XPath (not CSS) and throws in strict browsers.
function childByLocalName(parent, names) {
  if (!parent) return null;
  const wanted = new Set(names);
  let found = null;
  (function walk(node) {
    if (found) return;
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        if (wanted.has(child.localName)) { found = child; return; }
        walk(child);
      }
    }
  })(parent);
  return found;
}

function firstByLocalName(parent, names) {
  for (const name of names) {
    const el = parent.getElementsByTagName(name)[0];
    if (el) return el;
  }
  return null;
}

function textOf(el) {
  return el ? (el.textContent || '').trim() : '';
}

function htmlOf(el) {
  if (!el) return '';
  // Prefer the serialized inner HTML (preserves markup); fall back to text.
  const inner = (el.innerHTML || '').trim();
  if (!inner) return textOf(el);
  // XML/HTML serialization wraps CDATA'd markup as <![CDATA[ … ]]>; strip the
  // wrapper so the stored article body is clean HTML.
  return inner.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
}

function linkOf(el) {
  if (!el) return '';
  const href = el.getAttribute?.('href');
  if (href) return href;
  return el.textContent || '';
}

function guidOf(el) {
  if (!el) return '';
  const isPerma = el.getAttribute?.('permaLink') || el.getAttribute?.('isPermaLink');
  if (isPerma && isPerma.toLowerCase() !== 'true') return '';
  return el.textContent || '';
}

function atomLink(node) {
  const links = node.querySelectorAll('link');
  let fallback = '';
  for (const l of links) {
    const rel = (l.getAttribute('rel') || 'alternate').toLowerCase();
    if (rel === 'alternate') return l.getAttribute('href') || '';
    if (!l.getAttribute('href')) continue;
    if (!fallback) fallback = l.getAttribute('href') || '';
  }
  return fallback;
}

function atomHomeLink(node) {
  const links = node.querySelectorAll('link');
  for (const l of links) {
    if ((l.getAttribute('rel') || '').toLowerCase() === 'alternate') {
      return l.getAttribute('href') || '';
    }
  }
  return '';
}

function atomId(node) {
  const el = childByLocalName(node, ['id']);
  return el ? el.textContent || '' : '';
}

function atomAuthor(node) {
  const el = childByLocalName(node, ['author']);
  if (!el) return '';
  return textOf(el) || textOf(childByLocalName(el, ['name'])) || '';
}

function dateOf(el) {
  if (!el) return '';
  const raw = textOf(el);
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
