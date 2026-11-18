/* Apex Store — shell, catalog and install handling.
   Everything here runs in the tab; the only network use is the opt-in Play proxy. */
'use strict';

/* ---------- the 25 apps ---------- */

const APPS = [
  { id: 'ai',         name: 'Apex AI',        cat: 'AI',           path: '/apps/ai/',         status: 'ready',   offline: false,
    desc: 'Chat, search and artifacts across the suite’s models.' },
  { id: 'router',     name: 'Apex AI Router', cat: 'AI',           path: '/apps/router/',     status: 'planned', offline: false,
    desc: 'One endpoint in front of Groq, Gemini, Mistral and Cloudflare.' },
  { id: 'automation', name: 'Apex Automation', cat: 'Automation',  path: '/apps/automation/', status: 'preview', offline: false,
    desc: 'n8n flows and Workers that run the boring half of the suite.' },
  { id: 'drive',      name: 'Apex Drive',     cat: 'Files',        path: '/apps/drive/',      status: 'preview', offline: false,
    desc: '10 GB Backblaze B2 drive with presigned uploads.' },
  { id: 'drop',       name: 'Apex Drop',      cat: 'Files',        path: '/apps/drop/',       status: 'planned', offline: false,
    desc: 'Big-file handoff that stays inside one free tier.' },
  { id: 'auth',       name: 'Apex Auth',      cat: 'Security',     path: '/apps/auth/',       status: 'planned', offline: false,
    desc: 'Device sign-in and rotating tokens instead of pasted keys.' },
  { id: 'vault',      name: 'Apex Vault',     cat: 'Security',     path: '/apps/vault/',      status: 'ready',   offline: true,
    desc: 'Local-first secrets that never depend on a cloud account.' },
  { id: 'shield',     name: 'Apex Shield',    cat: 'Security',     path: '/apps/shield/',     status: 'ready',   offline: true,
    desc: 'File triage and APK static analysis, entirely in the tab.' },
  { id: 'sec',        name: 'Apex Sec',       cat: 'Security',     path: '/apps/sec/',        status: 'ready',   offline: true,
    desc: 'Header, reachability and payload audits with a report you can send.' },
  { id: 'browser',    name: 'Apex Browser',   cat: 'Utilities',    path: '/apps/browser/',    status: 'planned', offline: false,
    desc: 'Tabbed browsing with a cache that survives losing signal.' },
  { id: 'links',      name: 'Apex Links',     cat: 'Utilities',    path: '/apps/links/',      status: 'planned', offline: true,
    desc: 'Bookmarks and short links you host yourself.' },
  { id: 'gallery',    name: 'Apex Gallery',   cat: 'Media',        path: '/apps/gallery/',    status: 'ready',   offline: true,
    desc: 'Photo library layered on the drive, not a second copy of it.' },
  { id: 'camera',     name: 'Apex Camera',    cat: 'Media',        path: '/apps/camera/',     status: 'ready',   offline: true,
    desc: 'Photo and video capture that saves straight into Apex Gallery.' },
  { id: 'voice',      name: 'Apex Voice',     cat: 'Media',        path: '/apps/voice/',      status: 'ready',   offline: true,
    desc: 'Script to spoken narration with the voices already on the device.' },
  { id: 'video',      name: 'Apex Video',     cat: 'Media',        path: '/apps/video/',      status: 'ready',   offline: true,
    desc: 'Text slides rendered into a captioned video file you can download.' },
  { id: 'feed',       name: 'Apex Feed',      cat: 'Media',        path: '/apps/feed/',       status: 'ready',   offline: true,
    desc: 'Reader for the handful of feeds you actually read.' },
  { id: 'studio',     name: 'Apex Studio',    cat: 'Media',        path: '/apps/studio/',     status: 'planned', offline: false,
    desc: 'Image and asset studio for everything else in the suite.' },
  { id: 'docs',       name: 'Apex Docs',      cat: 'Knowledge',    path: '/apps/docs/',       status: 'planned', offline: true,
    desc: 'Documents small enough to finish in an evening.' },
  { id: 'notes',      name: 'Apex Notes',     cat: 'Knowledge',    path: '/apps/notes/',      status: 'ready',   offline: true,
    desc: 'Scratch notes that sync the moment there is network.' },
  { id: 'archive',    name: 'Apex Archive',   cat: 'Knowledge',    path: '/apps/archive/',    status: 'ready',   offline: true,
    desc: 'Clippings that keep their source and their date.' },
  { id: 'planner',    name: 'Apex Planner',   cat: 'Productivity', path: '/apps/planner/',    status: 'ready',   offline: true,
    desc: 'Tasks and calendar in one list, not two.' },
  { id: 'ledger',     name: 'Apex Ledger',    cat: 'Productivity', path: '/apps/ledger/',     status: 'ready',   offline: true,
    desc: 'A plain money ledger with no bank linking.' },
  { id: 'editor',     name: 'Apex Editor',    cat: 'Productivity', path: '/apps/editor/',     status: 'planned', offline: true,
    desc: 'Code and text editor wired to local files first.' },
  { id: 'pulse',      name: 'Apex Pulse',     cat: 'System',       path: '/apps/pulse/',      status: 'ready',   offline: true,
    desc: 'Device pulse and keep-alive checks for the URLs you watch.' },
  { id: 'backup',     name: 'Apex Backup',    cat: 'System',       path: '/apps/backup/',     status: 'planned', offline: false,
    desc: 'Scheduled backups of the suite’s data, within the free tier.' },
];

const STATUS_LABEL = { ready: 'Ready', preview: 'Preview', planned: 'In progress' };
const STATUS_RANK = { ready: 0, preview: 1, planned: 2 };

/* ---------- tiny helpers ---------- */

const $ = (id) => document.getElementById(id);

/* Shared ApexOS registry: installed apps, offline caches, cross-app channel. */
const R = window.ApexRegistry || null;
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = 0;
function toast(message) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2400);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
}

/* ---------- launch urls that work standalone and under /apps/store/ ---------- */

/* An absolute /apps/x/ path is right inside ApexOS. Served on its own, the store
   sits at the root, so the same path still resolves; a nested deployment keeps
   them absolute on purpose — that is where the shell puts the apps. */
function launchUrl(app) {
  return app.path;
}

/* ---------- install / home screen ---------- */

let deferredPrompt = null;

function openSheet(title, body, url) {
  $('sheetTitle').textContent = title;
  $('sheetBody').textContent = body;
  $('sheetUrl').textContent = url || '';
  $('sheet').hidden = false;
  $('sheetCopy').onclick = async () => {
    const ok = await copy($('sheetUrl').textContent);
    toast(ok ? 'Link copied' : 'Could not copy — select the text');
  };
}

function closeSheet() { $('sheet').hidden = true; }

function isAndroid() { return /android/i.test(navigator.userAgent); }

/* Play Store installs: native market:// on Android, web listing elsewhere. */
function installFromPlay(packageId, title) {
  const native = 'market://details?id=' + encodeURIComponent(packageId);
  const web = 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(packageId);
  if (isAndroid()) {
    toast('Opening Play Store…');
    location.href = native;
    // If the market:// handler is missing the page never leaves; offer the web listing.
    const started = Date.now();
    setTimeout(() => {
      if (document.visibilityState === 'visible' && Date.now() - started < 2200) {
        window.open(web, '_blank', 'noopener');
      }
    }, 1200);
    return;
  }
  window.open(web, '_blank', 'noopener');
  toast('Opened ' + (title || packageId) + ' on the web');
}

/* Adding an Apex app to the home screen is a browser action, not an API call —
   so say exactly what to press instead of pretending. */
function addToHome(app) {
  const url = new URL(launchUrl(app), location.href).href;
  const steps = isAndroid()
    ? 'Chrome ⋮ menu → “Add to Home screen”. The URL below is what it will add.'
    : 'In Chrome or Edge, use the install icon in the address bar, or ⋮ → “Cast, save and share” → “Install page as app”. The URL below is what it adds.';
  openSheet('Add ' + app.name + ' to the home screen', steps, url);
  $('sheetCopy').textContent = 'Copy link';
}

/* ---------- install / uninstall on this device ---------- */

function isInstalled(app) {
  return Boolean(R && R.isInstalled(app.id));
}

/* Install = fetch the app's core files into CacheStorage, record it in
   apex_installed_apps and tell the shell over BroadcastChannel('apex-os-apps'). */
async function toggleInstall(app, button) {
  if (!R) {
    toast('App registry unavailable — reload the store');
    return;
  }

  const wasInstalled = R.isInstalled(app.id);
  if (button) {
    button.disabled = true;
    button.textContent = wasInstalled ? 'Removing…' : 'Caching…';
  }

  try {
    if (wasInstalled) {
      await R.uninstall(app.id);
      toast(app.name + ' uninstalled');
    } else {
      const result = await R.install({ id: app.id, name: app.name, url: launchUrl(app), source: 'store' });
      const report = (result && result.report) || {};
      if (report.ok) {
        toast(app.name + ' installed — ' + report.cached + ' files cached for offline');
      } else {
        toast(app.name + ' added, but its files could not be cached (needs the bundled deployment)');
      }
    }
  } catch (err) {
    toast('Could not change ' + app.name);
  } finally {
    renderApps();
    paintCache();
  }
}

/* A pinned Play app is a shortcut: no files to cache, it leaves ApexOS. */
function pinPlayApp(item) {
  if (!R) {
    toast('App registry unavailable — reload the store');
    return;
  }
  const title = item.title || item.packageId;
  R.add({
    id: 'play-' + item.packageId,
    name: title,
    url: 'https://play.google.com/store/apps/details?id=' + encodeURIComponent(item.packageId),
    source: 'store',
  });
  toast(title + ' pinned to ApexOS');
}

/* ---------- rendering ---------- */

let activeCat = 'All';
let query = '';

function categories() {
  const seen = new Map();
  APPS.forEach((a) => seen.set(a.cat, (seen.get(a.cat) || 0) + 1));
  return [['All', APPS.length], ...Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]))];
}

function glyph(name) {
  const clean = name.replace(/^Apex\s+/i, '').trim();
  return (clean.slice(0, 2) || 'AP').toUpperCase();
}

function matches(app) {
  if (activeCat !== 'All' && app.cat !== activeCat) return false;
  if (!query) return true;
  const hay = (app.name + ' ' + app.cat + ' ' + app.desc + ' ' + app.path).toLowerCase();
  return hay.includes(query);
}

function card(app) {
  const node = document.createElement('article');
  node.className = 'card' + (app.status === 'planned' ? ' is-planned' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  const mark = document.createElement('span');
  mark.className = 'glyph';
  mark.textContent = glyph(app.name);
  const titleBox = document.createElement('div');
  titleBox.style.minWidth = '0';
  const h2 = document.createElement('h2');
  h2.textContent = app.name;
  const path = document.createElement('p');
  path.className = 'path';
  path.textContent = app.cat + ' · ' + app.path;
  path.title = app.path;
  titleBox.append(h2, path);
  head.append(mark, titleBox);

  const desc = document.createElement('p');
  desc.className = 'desc';
  desc.textContent = app.desc;

  const badges = document.createElement('div');
  badges.className = 'badges';
  const status = document.createElement('span');
  status.className = 'pill ' + (app.status === 'ready' ? 'ok' : app.status === 'preview' ? 'warn' : 'ghost');
  status.textContent = STATUS_LABEL[app.status];
  const offline = document.createElement('span');
  offline.className = 'pill ' + (app.offline ? 'ok' : 'ghost');
  offline.textContent = app.offline ? 'Offline ready' : 'Needs network';
  offline.title = app.offline
    ? 'Keeps working with no connection once loaded'
    : 'Needs a connection for its main function';
  badges.append(status, offline);

  if (isInstalled(app)) {
    const mine = document.createElement('span');
    mine.className = 'pill ok';
    mine.textContent = 'Installed';
    mine.title = 'On this device, with its own offline cache';
    badges.append(mine);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (app.status === 'planned') {
    const soon = document.createElement('button');
    soon.className = 'btn is-off';
    soon.disabled = true;
    soon.textContent = 'Not shipped yet';
    actions.append(soon);
  } else {
    const open = document.createElement('a');
    open.className = 'btn primary';
    open.href = launchUrl(app);
    open.textContent = 'Open';
    actions.append(open);

    const installed = isInstalled(app);
    const toggle = document.createElement('button');
    toggle.className = 'btn';
    toggle.type = 'button';
    toggle.textContent = installed ? 'Uninstall' : 'Install';
    toggle.title = installed
      ? 'Delete the offline copy of ' + app.name + ' from this device'
      : 'Cache ' + app.name + ' here and show it on the ApexOS screen';
    toggle.addEventListener('click', () => toggleInstall(app, toggle));
    actions.append(toggle);
  }

  const home = document.createElement('button');
  home.className = 'btn';
  home.type = 'button';
  home.textContent = 'Add to Home Screen';
  home.addEventListener('click', () => addToHome(app));
  actions.append(home);

  node.append(head, desc, badges, actions);
  return node;
}

function renderApps() {
  const grid = $('appGrid');
  const list = APPS.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));
  const shown = list.filter(matches);

  grid.replaceChildren(...shown.map(card));
  $('appEmpty').hidden = shown.length > 0;

  const cats = $('appCats');
  cats.replaceChildren(
    ...categories().map(([name, count]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (activeCat === name ? ' is-on' : '');
      chip.innerHTML = esc(name) + '<span class="count">' + count + '</span>';
      chip.setAttribute('aria-pressed', String(activeCat === name));
      chip.addEventListener('click', () => { activeCat = name; renderApps(); });
      return chip;
    })
  );
}

/* ---------- connection state ---------- */

function paintNet() {
  const node = $('netState');
  if (!node) return;
  const online = navigator.onLine;
  node.className = 'net ' + (online ? 'online' : 'offline');
  node.textContent = online
    ? 'online · the catalog and your cached searches work either way'
    : 'offline · catalog and cached Play results only';
}

/* ---------- cache footprint ---------- */

async function paintCache() {
  const stamp = $('cacheStamp');
  if (!stamp || !('caches' in window)) return;
  try {
    const names = await caches.keys();
    let entries = 0;
    let appCaches = 0;
    for (const name of names) {
      if (name.startsWith('apex-app-')) appCaches += 1;
      if (!name.startsWith('apex-store')) continue;
      entries += (await (await caches.open(name)).keys()).length;
    }
    stamp.textContent =
      (entries ? entries + ' files cached for offline' : 'not cached yet') +
      (appCaches ? ' · ' + appCaches + ' installed app' + (appCaches === 1 ? '' : 's') : '');
  } catch {
    stamp.textContent = '';
  }
}

/* ---------- wiring ---------- */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  });
  $('appsPanel').hidden = name !== 'apps';
  $('playPanel').hidden = name !== 'play';
}

function boot() {
  if (R) R.ensureSeeded();
  paintNet();
  renderApps();
  paintCache();

  /* Installs and uninstalls from another surface (ApexOS, Apex Settings). */
  if (R) {
    R.onMessage(R.appsChannel, () => {
      renderApps();
      paintCache();
    });
  }

  $('appSearch').addEventListener('input', (e) => {
    query = e.target.value.trim().toLowerCase();
    renderApps();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);

  $('sheetClose').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installStore').hidden = false;
  });

  $('installStore').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installStore').hidden = true;
    toast(choice && choice.outcome === 'accepted' ? 'Installing Apex Store' : 'Install dismissed');
  });
}

/* ---------- service worker (relative, so /apps/store/ works) ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        console.log('SW registered:', reg.scope);
        reg.addEventListener('updatefound', () => paintCache());
      })
      .catch((err) => {
        console.error('SW registration failed:', err);
      });
  });
}

window.ApexStore = { APPS, $, esc, toast, copy, openSheet, closeSheet, installFromPlay, isAndroid, launchUrl, paintCache, isInstalled, toggleInstall, pinPlayApp };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
