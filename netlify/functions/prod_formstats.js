// netlify/functions/prod_formstats.js
// Robuuste proxy naar je Cloudflare Worker met timeouts, retries, caps en nette errors.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

// ↑ Pas je Worker-URL aan indien nodig:
const UPSTREAM_BASE = 'https://atalian-logs.atalianqr.workers.dev/api/log';

// Limits om demo-stress te vermijden
const MAX_DAYS   = 31;   // max aantal dagen per call
const TIMEOUT_MS = 8000; // per poging
const RETRIES    = 2;    // totaal 1 + 2 = 3 pogingen (met backoff)

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET')     return json({ ok:false, msg:'Method Not Allowed' }, 405);

  const t0 = Date.now();
  try {
    const url  = new URL(req.url);
    const from = (url.searchParams.get('from') || '').slice(0,10);
    const to   = (url.searchParams.get('to')   || '').slice(0,10);
    const debug= url.searchParams.get('debug') === '1';
    const limit= clamp(int(url.searchParams.get('limit')), 1, 50000, 8000);

    // 1) Licht-valideren
    if (!isIso(from) || !isIso(to) || from > to) {
      return json({ ok:false, msg:'Invalid date range', from, to }, 400);
    }
    const span = daysBetween(from, to) + 1;
    if (span > MAX_DAYS) {
      return json({ ok:false, msg:`Range too large (> ${MAX_DAYS} days)`, from, to }, 413);
    }

    // 2) Upstream URL klaarzetten
    const upstream = new URL(UPSTREAM_BASE);
    upstream.searchParams.set('from', from);
    upstream.searchParams.set('to',   to);
    upstream.searchParams.set('limit', String(limit));
    if (debug) upstream.searchParams.set('debug', '1');

    // 3) Fetch met timeout + retries (exponential backoff)
    const { res, attempt, elapsed } = await fetchWithRetries(upstream.toString(), {
      timeoutMs: TIMEOUT_MS,
      retries:   RETRIES,
      headers:   { 'Accept': 'application/json' }
    });

    if (!res) {
      // helemaal niet bereikbaar
      return json({
        ok:false, code:'UPSTREAM_UNREACHABLE',
        msg:'Upstream not reachable within timeouts',
        attempts: attempt, elapsed_ms: elapsed
      }, 504);
    }
    if (!res.ok) {
      // upstream gaf 4xx/5xx → geef dit duidelijk door
      const text = await safeText(res);
      return json({
        ok:false, code:'UPSTREAM_ERROR',
        status: res.status, statusText: res.statusText,
        body: truncate(text, 600)
      }, mapStatus(res.status));
    }

    // 4) Succes – transparant doorgeven (eventueel minimal transform)
    const body = await res.text(); // hou raw (sneller)
    const headers = { ...CORS };
    return new Response(body, { status: 200, headers });

  } catch (e) {
    return json({
      ok:false, code:'FUNCTION_ERROR',
      error: e?.name || 'Error',
      message: e?.message || String(e),
      elapsed_ms: Date.now() - t0
    }, 502);
  }
};

/* ----------------- Helpers ----------------- */

function json(obj, status=200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

function isIso(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function int(v){ const n = parseInt(v,10); return Number.isFinite(n) ? n : NaN; }
function clamp(n,min,max,fb){ return Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fb; }
function daysBetween(a,b){
  const d1 = new Date(a+'T00:00:00Z').getTime();
  const d2 = new Date(b+'T00:00:00Z').getTime();
  return Math.round((d2 - d1) / 86400000);
}
async function safeText(r){ try { return await r.text(); } catch { return ''; } }
function truncate(s, n){ return (s && s.length>n) ? (s.slice(0,n)+'…') : s; }
function mapStatus(s){ return (s>=500) ? 502 : 502; } // bewust 502 terug naar client

async function fetchWithRetries(url, { timeoutMs, retries, headers }){
  const start = Date.now();
  let attempt = 0, res = null, lastErr = null;
  while (attempt <= retries) {
    attempt++;
    try {
      res = await fetchWithTimeout(url, timeoutMs, { headers });
      return { res, attempt, elapsed: Date.now() - start };
    } catch (e) {
      lastErr = e;
      // AbortError / timeout / netwerkfout → even backoff en opnieuw
      if (attempt > retries) break;
      await sleep(200 * Math.pow(2, attempt-1)); // 200ms, 400ms, 800ms…
    }
  }
  return { res: null, attempt, error: lastErr, elapsed: Date.now() - start };
}

async function fetchWithTimeout(resource, ms, init={}){
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(resource, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
