/* Apex Store — Google Play search proxy (Cloudflare Worker).
 *
 *   GET /?q=<term>&hl=en&gl=US   -> { query, count, results: [{packageId,title,developer,rating,icon,url}], fetchedAt }
 *   GET /health                  -> { ok: true }
 *
 * Play serves its search page as HTML with no CORS headers, so a browser cannot
 * read it directly. This Worker fetches the same page, extracts the app rows and
 * returns JSON. Successful responses sit in the Cloudflare Cache API for 30
 * minutes, which keeps the Worker inside the free request tier.
 *
 * The parser reads the server-rendered result markup:
 *   <a class="Si6A0c Gy4nib" href="/store/apps/details?id=<pkg>"> ... </a>
 *     <span class="DdYX5">Title</span>
 *     <span class="wMUdtb">Developer</span>
 *     role="img" aria-label="Rated 4.8 stars out of five stars"
 *     <img src="https://play-lh.googleusercontent.com/....=s64-rw">
 * Google changes class names without warning. When nothing matches, the Worker
 * returns an empty list plus a hint instead of inventing rows — the store shows
 * that hint rather than pretending the search failed silently.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TTL_SECONDS = 1800;
const MAX_RESULTS = 24;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'accept, content-type',
  'access-control-max-age': '86400',
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS,
      ...extra,
    },
  });

const decode = (text) =>
  String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Pull app rows out of a Play search page. Exported so it can be tested in node. */
export function parseSearch(html, limit = MAX_RESULTS) {
  const source = String(html || '');
  const starts = [];
  const anchor = '<a class="Si6A0c';
  let at = source.indexOf(anchor);
  while (at !== -1) {
    starts.push(at);
    at = source.indexOf(anchor, at + anchor.length);
  }

  const seen = new Set();
  const results = [];

  for (let i = 0; i < starts.length && results.length < limit; i += 1) {
    const block = source.slice(starts[i], starts[i + 1] || starts[i] + 4000);

    const pkg = block.match(/href="\/store\/apps\/details\?id=([A-Za-z0-9_.]+)"/);
    const title = block.match(/class="DdYX5"[^>]*>([^<]+)</);
    if (!pkg || !title) continue;

    const packageId = pkg[1];
    if (seen.has(packageId)) continue;
    seen.add(packageId);

    const developer = block.match(/class="wMUdtb"[^>]*>([^<]+)</);
    const rating = block.match(/aria-label="Rated ([\d.]+) stars/);

    let icon = '';
    const images = block.match(/<img[^>]+src="https:\/\/play-lh\.googleusercontent\.com\/[^"]+"/g) || [];
    if (images.length) {
      const scaled = images.find((tag) => /=(s\d+|w\d+-h\d+)-rw/.test(tag) && /=s\d+-rw/.test(tag));
      const chosen = scaled || images[images.length - 1];
      const src = chosen.match(/src="([^"]+)"/);
      if (src) icon = src[1];
    }

    results.push({
      packageId,
      title: decode(title[1]),
      developer: developer ? decode(developer[1]) : '',
      rating: rating ? Number(rating[1]) : null,
      icon,
      url: 'https://play.google.com/store/apps/details?id=' + packageId,
    });
  }

  return results;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405);
    }
    if (url.pathname === '/health' || url.pathname === '/healthz') {
      return json({ ok: true, service: 'apex-play-proxy' });
    }

    const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
    if (!q) return json({ error: 'missing q' }, 400);

    const hl = (url.searchParams.get('hl') || 'en').slice(0, 5);
    const gl = (url.searchParams.get('gl') || 'US').slice(0, 5).toUpperCase();

    const cache = caches.default;
    const cacheKey = new Request(
      url.origin + url.pathname + '?q=' + encodeURIComponent(q) + '&hl=' + hl + '&gl=' + gl,
      { method: 'GET' }
    );

    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('x-apex-cache', 'hit');
      return hit;
    }

    const target =
      'https://play.google.com/store/search?q=' +
      encodeURIComponent(q) +
      '&c=apps&hl=' +
      hl +
      '&gl=' +
      gl;

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: {
          'user-agent': UA,
          'accept-language': hl + ',' + hl + ';q=0.9',
          accept: 'text/html,application/xhtml+xml',
        },
        cf: { cacheTtl: 0 },
      });
    } catch (err) {
      return json({ error: 'upstream fetch failed', detail: String(err && err.message) }, 502);
    }

    if (!upstream.ok) {
      return json({ error: 'Play returned ' + upstream.status }, 502);
    }

    const html = await upstream.text();
    const results = parseSearch(html);

    const body = {
      query: q,
      count: results.length,
      results,
      fetchedAt: new Date().toISOString(),
      hint: results.length
        ? undefined
        : 'No rows matched. Play likely changed its markup; update parseSearch in worker/play-proxy.js.',
    };

    const response = json(body, 200, {
      'cache-control': 'public, max-age=' + TTL_SECONDS,
    });

    // Only cache usable answers, so one bad parse does not stick for 30 minutes.
    if (results.length) {
      const toStore = response.clone();
      toStore.headers.set('cache-control', 'public, max-age=' + TTL_SECONDS);
      await cache.put(cacheKey, toStore);
    }

    return response;
  },
};
