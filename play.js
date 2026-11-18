/* Apex Store — Google Play tab.
   Play has no CORS-friendly API, so searches go to a user-hosted Worker
   (worker/play-proxy.js). Every successful search is mirrored into IndexedDB so
   the last results per term keep working with no network. */
'use strict';

(function () {
  const PROXY_KEY = 'apex-store:proxy';
  const DB_NAME = 'apex-store';
  const DB_VERSION = 1;
  const STORE = 'play';

  const S = window.ApexStore;
  if (!S) return;
  const { $, esc, toast } = S;

  const SUGGESTIONS = ['Games', 'Productivity', 'Social', 'Tools', 'Photos', 'Music'];

  /* ---------- IndexedDB ---------- */

  let dbPromise = null;

  function db() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const conn = req.result;
          if (!conn.objectStoreNames.contains(STORE)) {
            conn.createObjectStore(STORE, { keyPath: 'q' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function cachePut(key, payload) {
    try {
      const conn = await db();
      await new Promise((resolve, reject) => {
        const tx = conn.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ q: key, at: Date.now(), payload });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* Private mode or a blocked upgrade: the tab still works, just without cache. */
    }
  }

  async function cacheGet(key) {
    try {
      const conn = await db();
      return await new Promise((resolve, reject) => {
        const tx = conn.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function cacheCount() {
    try {
      const conn = await db();
      return await new Promise((resolve) => {
        const tx = conn.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  /* ---------- proxy config ---------- */

  function proxy() {
    try {
      return (localStorage.getItem(PROXY_KEY) || '').trim().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  function paintProxyState() {
    const url = proxy();
    const state = $('proxyState');
    const hint = $('playNote');
    if (state) {
      state.textContent = url
        ? 'Using ' + url
        : 'No proxy set, so live searches are off. Offline results already in this browser still work.';
      state.style.color = url ? '' : 'var(--warn)';
    }
    if (hint && !hint.dataset.set) {
      hint.innerHTML = url
        ? 'Search results come from your Worker and are cached per term.'
        : 'Set the proxy endpoint below to search Play. Without it this tab shows <strong>cached</strong> results only.';
    }
  }

  /* ---------- rendering ---------- */

  function ago(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + ' h ago';
    return Math.round(hours / 24) + ' d ago';
  }

  function row(item) {
    const node = document.createElement('div');
    node.className = 'row';

    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    if (item.icon) img.src = item.icon;

    const main = document.createElement('div');
    main.className = 'row-main';

    const h3 = document.createElement('h3');
    h3.textContent = item.title || item.packageId;
    const dev = document.createElement('p');
    dev.className = 'dev';
    dev.textContent = item.developer || 'unknown developer';

    const meta = document.createElement('p');
    meta.className = 'meta';
    if (item.rating) {
      const r = document.createElement('span');
      r.textContent = '★ ' + item.rating;
      meta.append(r);
    }
    const pkg = document.createElement('span');
    pkg.className = 'pkg';
    pkg.textContent = item.packageId;
    meta.append(pkg);

    main.append(h3, dev, meta);

    const install = document.createElement('button');
    install.className = 'btn primary';
    install.type = 'button';
    install.textContent = 'Install';
    install.addEventListener('click', () => S.installFromPlay(item.packageId, item.title));

    node.append(img, main, install);
    return node;
  }

  function paint(items, note) {
    const list = $('playList');
    list.replaceChildren(...items.map(row));
    const n = $('playNote');
    if (n) {
      n.innerHTML = note;
      n.dataset.set = '1';
    }
  }

  function empty(message) {
    const list = $('playList');
    list.replaceChildren();
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = message;
    list.append(p);
  }

  /* ---------- search ---------- */

  let lastQuery = '';

  async function search(term) {
    const q = (term || '').trim();
    if (!q) { empty('Type something to search for.'); return; }
    lastQuery = q;
    const key = q.toLowerCase();
    const endpoint = proxy();

    if (!endpoint) {
      const hit = await cacheGet(key);
      if (hit) {
        paint(hit.payload, 'Showing <strong>cached</strong> results for “' + esc(q) + '” from ' + ago(hit.at) + '. Set a proxy endpoint for live search.');
      } else {
        empty('No live search without a proxy endpoint, and nothing cached for “' + q + '” yet.');
      }
      return;
    }

    if (!navigator.onLine) {
      const hit = await cacheGet(key);
      if (hit) paint(hit.payload, 'Offline. Showing <strong>cached</strong> results from ' + ago(hit.at) + '.');
      else empty('Offline, and “' + q + '” has never been searched in this browser.');
      return;
    }

    empty('Searching Google Play…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const url = endpoint + '/?q=' + encodeURIComponent(q) + '&hl=en&gl=US';
      const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error('proxy returned ' + res.status);
      const body = await res.json();
      const items = Array.isArray(body.results) ? body.results : [];
      await cachePut(key, items);
      if (!items.length) {
        empty('Play returned no apps for “' + q + '”. The proxy may need its parser updated.');
      } else {
        paint(items, 'Live from your Worker · ' + items.length + ' results · cached for offline.');
      }
    } catch (err) {
      const hit = await cacheGet(key);
      const networkish = err.name === 'AbortError' || /failed to fetch|networkerror|load failed/i.test(err.message || '');
      if (hit) {
        const why = err.name === 'AbortError' ? 'the proxy timed out' : esc(err.message);
        paint(hit.payload, 'Live search failed (' + why + '). Showing <strong>cached</strong> results from ' + ago(hit.at) + '.');
      } else if (!navigator.onLine || networkish) {
        empty('No connection, and “' + q + '” has never been searched in this browser. Cached terms still work.');
      } else {
        empty('Search failed: ' + err.message + '. Check the proxy endpoint and that your Worker is deployed.');
      }
    } finally {
      clearTimeout(timer);
    }
    S.paintCache();
  }

  /* ---------- wiring ---------- */

  function boot() {
    paintProxyState();

    const form = $('playForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        search($('playQuery').value);
      });
    }

    const proxyForm = $('proxyForm');
    if (proxyForm) {
      $('proxyUrl').value = proxy();
      proxyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = $('proxyUrl').value.trim().replace(/\/+$/, '');
        try {
          if (value && !/^https?:\/\//i.test(value)) {
            toast('Use a full https:// URL');
            return;
          }
          localStorage.setItem(PROXY_KEY, value);
        } catch {
          toast('Storage is blocked in this browser');
          return;
        }
        paintProxyState();
        toast(value ? 'Proxy saved' : 'Proxy cleared');
      });
    }

    const chips = $('playCats');
    if (chips) {
      chips.replaceChildren(
        ...SUGGESTIONS.map((name) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.textContent = name;
          chip.addEventListener('click', () => {
            $('playQuery').value = name;
            chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === chip));
            search(name);
          });
          return chip;
        })
      );
    }

    cacheCount().then(async (n) => {
      if (n > 0) {
        const node = $('playNote');
        if (node && !node.dataset.set) {
          node.textContent = n + ' search' + (n === 1 ? '' : 'es') + ' cached in this browser for offline use.';
        }
      }
    });

    // A search that was running when the tab was closed is not resumed; the cache is.
    if (lastQuery) search(lastQuery);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
