// netlify/functions/proxy_logs.js
// Proxy naar Cloudflare Worker met CORS, preflight (OPTIONS), no-store cache, limit-cap en retry/backoff.

const BASE = 'https://atalian-logs.atalianqr.workers.dev/api/log';
const MAX_LIMIT = 2000;             // hard cap om 5xx door te grote payloads te vermijden
const TIMEOUT_MS = 8000;            // upstream timeout
const RETRIES = 2;                   // aantal herpogingen bij 5xx/netwerkfout
const BACKOFF_MS = 500;             // start backoff

// Optionele origin-allowlist (prod + previews + lokaal)
const ALLOWLIST = [
  /\.netlify\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i
];

const withNoStore = (headers = {}) => ({
  ...headers,
  'Cache-Control': 'no-store'
});

function isAllowedOrigin(origin) {
  try {
    const { host } = new URL(origin);
    return ALLOWLIST.some((rx) => rx.test(host));
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin);
  // reflecteer enkel toegelaten origins; zo niet, laat open voor demo
  const aco = allowed ? origin : '*';
  return {
    'Access-Control-Allow-Origin': aco,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function upstreamGet(limit) {
  const target = `${BASE}?limit=${encodeURIComponent(limit)}`;
  let lastErr, delay = BACKOFF_MS;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(target, { method: 'GET', headers: { 'Cache-Control': 'no-store' } });
      console.log('[proxy_logs] GET', target, '→', res.status);
      if (res.status >= 500 && res.status < 600) throw new Error(`Upstream ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      console.warn(`[proxy_logs] GET fail (try ${attempt+1}/${RETRIES+1})`, e?.message || e);
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, delay)), delay *= 2;
    }
  }
  throw lastErr;
}

async function upstreamPost(body) {
  let lastErr, delay = BACKOFF_MS;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body
      });
      console.log('[proxy_logs] POST →', res.status);
      if (res.status >= 500 && res.status < 600) throw new Error(`Upstream ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      console.warn(`[proxy_logs] POST fail (try ${attempt+1}/${RETRIES+1})`, e?.message || e);
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, delay)), delay *= 2;
    }
  }
  throw lastErr;
}

export default async (req, context) => {
  const origin = req.headers.get('origin') || '*';
  const cors = corsHeaders(origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withNoStore(cors) });
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const raw = Number(url.searchParams.get('limit') ?? 1000);
      const limit = Math.max(1, Math.min(isFinite(raw) ? raw : 1000, MAX_LIMIT));

      const upstream = await upstreamGet(limit);
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: withNoStore({
          ...cors,
          'Content-Type': upstream.headers.get('content-type') || 'application/json'
        })
      });
    }

    if (req.method === 'POST') {
      const body = await req.text();
      console.log('[proxy_logs] POST body length:', body?.length ?? 0);

      const upstream = await upstreamPost(body);
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: withNoStore({
          ...cors,
          'Content-Type': upstream.headers.get('content-type') || 'application/json'
        })
      });
    }

    return new Response('Method Not Allowed', { status: 405, headers: withNoStore(cors) });
  } catch (e) {
    console.error('[proxy_logs] ERROR', e?.stack || e?.message || e);
    const payload = { error: 'Proxy error', detail: String(e) };
    return new Response(JSON.stringify(payload), {
      status: 502,
      headers: withNoStore({ ...cors, 'Content-Type': 'application/json' })
    });
  }
};
