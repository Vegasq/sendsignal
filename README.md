# sscc — a Google Reader-style RSS reader

A feed reader that runs **entirely in the browser**, has **no backend**, and is
deployed to **GitHub Pages**. Subscriptions, read state, folders, and search are
all stored locally on the machine that opens the app.

## Design constraints (and what they force)

| Constraint | Consequence |
|---|---|
| No backend | No server can fetch feeds for us. Browsers block cross-origin `fetch` to feed URLs (CORS). |
| GitHub Pages | Pure static output (`dist/`). Deploy = push a branch or a GitHub Action artifact. |
| Runs in browser | Lightweight state (feeds/folders/read/theme/proxy/interval) lives in `localStorage`; full article bodies live in `IndexedDB` (no 5 MB cap) and survive reloads. |

### The CORS problem — and how we solve it

A feed URL like `https://example.com/rss` may or may not be `fetch`ed directly
from a Pages-hosted SPA: the feed host must send `Access-Control-Allow-Origin`,
and many don't. So `src/lib/proxy.js` tries the origin **directly first**, and
only routes through a **pluggable CORS proxy** when the origin blocks the
cross-origin read (or returns something that isn't a feed). A public proxy is
used by default so the app works out of the box; a
user-supplied proxy can be set in Settings. This is the one third-party
dependency the architecture accepts, and it is isolated behind a single module
so it can be swapped (or replaced by a self-hosted proxy / GitHub Actions
worker) later without touching the UI.

A response is accepted only if its body looks like a feed (RSS 2.0, Atom, or
RDF/RSS 1.0) — a 200 from a reader service or an HTML error page never
masquerades as a feed.

Feed content is fetched as text and parsed client-side with `DOMParser`
(`src/lib/feedParser.js`), supporting **RSS 2.0, Atom, and RDF/RSS 1.0**.

## Architecture

```
Browser SPA (React + Vite static build)
│
├─ proxy.js        fetch feed URL  -> raw XML text  (swap the transport)
├─ feedParser.js   XML text        -> normalized feed + items
├─ store.js        feeds/folders/read-ids/refresh  <-> localStorage (lightweight state)
├─ db.js           full article bodies <-> IndexedDB (survive reloads, 100/feed)
├─ refresh.js      periodic + on-visible refresh, throttled per feed
│
└─ components/
   ├─ Sidebar.jsx      folders + feed list (+ counts)
   ├─ ArticleList.jsx  items for selected feed(s), unread badge, mark-all-read
   ├─ Reader.jsx       full article view, mark read/unread, prev/next
   ├─ AddFeedDialog.jsx  subscribe by URL
   ├─ ImportDialog.jsx   OPML import / export
   ├─ SettingsDialog.jsx theme + custom proxy settings
   └─ ContextMenu.jsx    right-click feed actions (move/unsubscribe)
```

**State model** (`store.js`):
- `feeds: [{id, url, title, folder, lastUpdated}]` — persisted in `localStorage`
- `folders: string[]`
- `read: Set<itemId>` persisted as a JSON array
- `items` (full article bodies) cached in memory and mirrored to `IndexedDB`
  (`db.js`), hydrated on load so content survives reloads. Each feed keeps its
  newest 100 items.
- `refresh: {lastRun, intervalMs, running, errors}` — scheduler status surfaced
  to the header (last-updated time, busy spin, per-feed error count).

## Features (MVP — implemented)

- Subscribe by feed URL (auto-detects RSS/Atom/RDF).
- OPML import/export (Google Reader / Feedly migration).
- Folders to group feeds. Create folders inline with the **+** button and drag
  feeds into a folder — or into **Uncategorized** at the bottom of the sidebar.
- Save (bookmark) any post with a ★; saved posts live in a dedicated **Saved**
  folder and survive reloads.
- vi / Google-Reader hotkeys: `j`/`k` (or ↓/↑) move through the list, `g`/`G`
  (or Home/End) jump to the top/bottom, `x` marks read, `u` marks unread. They
  are ignored while the cursor is in a field (e.g. the search box).
- Unread counts per feed; mark individual or all as read.
- Full-text reader with prev/next and in-reader read toggles.
- Full-text search across subscribed feeds.
- Automatic refresh on an interval (15/30/60/180 min) and whenever you return to
  the tab; feeds refreshed within the last 15 minutes are skipped. The ⟳ button
  forces an immediate refresh and bypasses the throttle.
- Article bodies persist in `IndexedDB`, so the inbox reloads instantly and
  works offline after the first load.
- Dark mode; all preferences persisted locally.
- Offline after first load (static assets + IndexedDB cache).

## Roadmap

| Priority | Item | Notes |
|---|---|---|
| MVP | Feed fetch/parse, folders, read state, search | done |
| MVP | IndexedDB for article bodies | persist full content across reloads | done |
| MVP | Periodic + on-visible refresh | throttled per feed; manual override | done |
| P2 | Self-hosted proxy option + `:8080` dev proxy | removes public-proxy rate limits |
| P3 | Infinite scroll / virtualized long lists | >1000 items |
| P3 | Reading time, "only unread", sort by date | UX |
| P3 | Service Worker for true background fetch | background refresh needs a proxy |
| P4 | Keyboard shortcuts (g a g u j k) | Google Reader muscle memory | done |
| P4 | Push notifications for new items | needs a background fetch source |

## Deploy to GitHub Pages

1. Push this repo.
2. Vite build emits `dist/`. Use the GitHub Action in
   `.github/workflows/deploy.yml` (or push `dist/` to a `gh-pages` branch).
3. **Subpath note:** if deployed at `github.com/<user>/sscc/`, set `base: '/sscc/'`
   in `vite.config.js` (override with `VITE_GH_BASE='/sscc/'` in the workflow).
   For a root site (`github.com/<user>/`) set `base: '/'`.

### Custom domain (e.g. `sendsignal.cc`)

This app is intended to run as a **root Pages site** on a custom domain, so the
default `base` is `/` (assets load from `/assets/…`). To deploy:

1. In **Settings → Pages**, set the source to your branch and, under
   **Custom domain**, enter `sendsignal.cc`.
2. Point the domain at GitHub in DNS: a `CNAME` `sendsignal.cc → <user>.github.io`
   (and A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
   `185.199.111.153` for an apex/`@` record if your provider needs it).
3. Add a `CNAME` file at the repo root containing `sendsignal.cc` so GitHub
   verifies ownership.
4. Back in Pages, enable **Enforce HTTPS** (wait for the DNS/CNAME to propagate).


## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run preview  # serve the production build locally
npm test         # node feature tests (IndexedDB round-trip, hydration, throttle; RSS/Atom/RDF feed parsing)
```

## Tech stack

Vite + React + plain CSS. No routing library (state-driven panes), no Redux
(store module with change notifications). Deliberately minimal to keep the
bundle small and the dependency surface tiny — appropriate for a static Pages
deploy.
