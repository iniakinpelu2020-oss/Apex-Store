# Apex Store

The storefront for the suite: one page that lists all 25 Apex Ecosystem apps and, in a
second tab, searches Google Play through a Worker you own.

It is a static PWA with no build step and no dependencies. Every path is relative
(`./`), so the same folder works when opened on its own, installed on Android, or
mounted by ApexOS at `/apps/store/`.

```
index.html      two tabs, search, install sheet
styles.css      dark glass theme
store.js        the 25-app catalog, filtering, install + home-screen handling
play.js         Google Play tab: proxy calls, IndexedDB cache, market:// installs
sw.js           offline shell (relative URLs, scoped to the store's own folder)
manifest.json   standalone display, relative start_url and scope
worker/         Cloudflare Worker that turns Play search HTML into JSON
```

## The two tabs

**Apex Apps.** All 25 apps with category, description and two badges: shipping status
(`Ready` / `Preview` / `In progress`) and whether the app keeps working offline. Each
card has **Open** (the app's real launch path, `/apps/x/`) and **Add to Home Screen**.

Only seven apps are `Ready` today — Apex AI, Apex Sec, Apex Shield, Apex Camera, Apex Voice, Apex
Video and this store — two are `Preview` (Automation, Drive) and the remaining sixteen are still
READMEs. The badges say so; the store does not pretend otherwise. Cards for unshipped apps have
**Open** disabled rather than linking to a 404.

**Google Play.** A search box and category chips that query your Worker. Because Play has
no CORS-friendly API, nothing is fetched from the browser directly.

## Install behaviour

| Situation | What tapping Install does |
| --- | --- |
| Android (`/android/i` in the user agent) | `market://details?id=<package>` — the native Play Store screen. If no `market://` handler answers within ~1.2 s, the web listing opens instead. |
| Desktop | Opens `https://play.google.com/store/apps/details?id=<package>` in a new tab. |

"Add to Home Screen" for an Apex app explains the browser's own action (Chrome ⋮ →
Add to Home screen) and puts the app's URL on the clipboard — a page cannot add another
page to the home screen, and the button does not claim to. For Apex Store itself the
button uses the real `beforeinstallprompt` when the browser offers it.

## Offline behaviour

- `sw.js` precaches the shell and answers navigations from cache when the network fails.
  Assets are served from cache immediately and refreshed in the background.
- Play searches are mirrored into IndexedDB under the search term. Re-running a term
  while offline (or when the Worker is down) shows those results with their age.
- The footer reports how many files the store has cached.

The Worker is never cached by the service worker — its answers come from IndexedDB.

## Deploying the search proxy

```bash
cd worker
npx wrangler deploy            # needs a free Cloudflare account, no card
```

`wrangler.toml` sets `workers_dev = true`, so you get
`https://apex-play-proxy.<your-subdomain>.workers.dev`. Paste that into **Google Play →
Search proxy endpoint** in the store; it is saved in `localStorage` and trims a trailing
slash for you.

Endpoint contract:

```
GET /?q=<term>&hl=en&gl=US  ->  { query, count, results: [{ packageId, title, developer, rating, icon, url }] }
GET /health                 ->  { ok: true }
```

Successful answers are cached in the Cloudflare Cache API for 30 minutes; failures and
empty parses are not cached, so one bad response does not stick.

### On parsing Play

The Worker reads the server-rendered result markup: an `<a class="Si6A0c">` per app,
`span.DdYX5` for the title, `span.wMUdtb` for the developer, `aria-label="Rated N stars…"`
and a `=s64-rw` icon. Google changes class names without notice. When nothing matches,
the Worker returns `count: 0` with a `hint` and the store prints that hint instead of
showing an empty list as if the search simply had no results. Fixing it means editing
`parseSearch` — one function, no other moving parts.

## Running it

Any static server works:

```bash
python3 -m http.server 3000
```

Service workers need `https` or `localhost`. When the store is mounted at `/apps/store/`
the relative registration (`./sw.js`, scope `./`) keeps the worker inside that folder
instead of claiming the whole origin.

## State of this repo

Verified: catalog rendering and search, tab switching, the Play tab's live/cached/failure
paths including IndexedDB reuse while offline, `market://` vs desktop install routing,
and the Worker's parser against a real Play search page (24 rows, all with title,
developer, rating and icon).

Not verified: a real Play Store install from an Android device, and the Worker as a
deployed Cloudflare service (it was exercised in node, not in production).
