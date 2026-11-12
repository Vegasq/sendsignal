// Tests for src/lib/feedParser.js — the RSS 2.0 / Atom / RDF(RSS 1.0) normalizer.
//
// Parsing uses the browser's DOMParser, so jsdom supplies it. jsdom is chosen
// because it processes XML namespaces faithfully (localName drops the prefix,
// namespaceURI is correct) — happy-dom/linkedom do not, and would hide the very
// bug this suite targets: fields were matched with
// querySelector('*[local-name()="…"]'), which is XPath (not CSS) and throws in
// strict browsers.
//
//   node test/feedParser.test.mjs

import { JSDOM } from 'jsdom';
globalThis.DOMParser = new JSDOM('', { url: 'http://localhost/' }).window.DOMParser;

const { parseFeed } = await import('../src/lib/feedParser.js');

let failures = 0;
let passes = 0;
function ok(cond, msg) { if (cond) { passes++; } else { failures++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) {
  const aS = JSON.stringify(a), bS = JSON.stringify(b);
  if (aS === bS) { passes++; } else { failures++; console.log(`  ✗ ${msg} [got ${aS}, want ${bS}]`); }
}

console.log('\nRSS 2.0 — namespaced content:encoded + dc:creator');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.1/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>My Feed</title>
    <link>https://example.com/</link>
    <description>Demo</description>
    <item>
      <title>Post One</title>
      <link>https://example.com/1</link>
      <guid>https://example.com/1#id</guid>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
      <dc:creator>Alice</dc:creator>
      <content:encoded><![CDATA[<h1>HTML body</h1>]]></content:encoded>
    </item>
    <item>
      <title>Post Two</title>
      <author>Bob</author>
      <updated>2024-01-02T10:00:00Z</updated>
    </item>
  </channel>
</rss>`;
const f = parseFeed(rss, 'https://example.com/rss');
eq(f.title, 'My Feed', 'channel title');
eq(f.homePage, 'https://example.com/', 'channel link -> homePage');
eq(f.items.length, 2, 'two items');
eq(f.items[0].title, 'Post One', 'item title');
eq(f.items[0].link, 'https://example.com/1', 'item link');
eq(f.items[0].content, '<h1>HTML body</h1>', 'content:encoded (namespaced) parsed');
eq(f.items[0].author, 'Alice', 'dc:creator (namespaced) -> author');
eq(f.items[0].published, '2024-01-01T10:00:00.000Z', 'pubDate -> ISO');
eq(f.items[1].author, 'Bob', 'plain <author> -> author');
eq(f.items[1].published, '2024-01-02T10:00:00.000Z', 'updated -> ISO');

console.log('\nAtom — self vs alternate link, author <name>, summary');
const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link rel="self" href="https://atom.example.com/feed"/>
  <link rel="alternate" href="https://atom.example.com/"/>
  <entry>
    <title>Atom Entry</title>
    <link rel="self" href="https://atom.example.com/entry1/self"/>
    <link rel="alternate" href="https://atom.example.com/entry1"/>
    <id>urn:uuid:entry1</id>
    <author><name>Carol</name></author>
    <updated>2024-01-03T10:00:00Z</updated>
    <summary>Atom summary</summary>
  </entry>
</feed>`;
const a = parseFeed(atom, 'https://atom.example.com/feed');
eq(a.title, 'Atom Feed', 'feed title');
eq(a.homePage, 'https://atom.example.com/', 'alternate link (not self) -> homePage');
eq(a.items.length, 1, 'one entry');
eq(a.items[0].title, 'Atom Entry', 'entry title');
eq(a.items[0].link, 'https://atom.example.com/entry1', 'entry alternate link (not self)');
eq(a.items[0].id, 'urn:uuid:entry1', 'entry id');
eq(a.items[0].author, 'Carol', 'author <name> -> author');
eq(a.items[0].content, 'Atom summary', 'summary -> content');
eq(a.items[0].published, '2024-01-03T10:00:00.000Z', 'updated -> ISO');

console.log('\nRDF / RSS 1.0');
const rdf = `<?xml version="1.0"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <channel rdf:about="https://rdf.example.com/">
    <title>RDF Feed</title>
    <link>https://rdf.example.com/</link>
  </channel>
  <item rdf:about="https://rdf.example.com/1">
    <title>RDF Item</title>
    <link>https://rdf.example.com/1</link>
  </item>
</rdf:RDF>`;
const r = parseFeed(rdf, 'https://rdf.example.com/feed');
eq(r.title, 'RDF Feed', 'rdf channel title');
eq(r.items.length, 1, 'one rdf item');
eq(r.items[0].title, 'RDF Item', 'rdf item title');

console.log('\nMalformed XML is reported, not thrown as a selector error');
let threw = false;
try { parseFeed('<rss><channel><title>unclosed', 'https://x/feed'); } catch (e) { threw = /Malformed XML/.test(e.message); }
ok(threw, 'unclosed tag -> Malformed XML');

console.log(`\n${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
