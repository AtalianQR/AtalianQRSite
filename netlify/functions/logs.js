\
/**
 * Netlify Function: /.netlify/functions/logs
 * Proxy naar Cloudflare Worker met robuuste JSON-normalisatie en CORS.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

const UPSTREAM = 'https://atalian-logs.atalianqr.workers.dev/api/log';
const TIMEOUT_MS = 8000;

export default async (req /*, context */) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Querystring doorgeven
  const u = new URL(req.url);
  const qs = u.search || '';

  // Headers meenemen (Authorization indien aanwezig)
  const headersOut = {
    'Accept': 'application/json',
  };
  const ct = req.headers.get('Content-Type');
  if (ct) headersOut['Content-Type'] = ct;
  const auth = req.headers.get('Authorization');
  if (auth) headersOut['Authorization'] = auth;

  // Body doorgeven voor niet-GET/HEAD
  const init = { method: req.method, headers: headersOut };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      init.body = await req.text();
    } catch { init.body = ''; }
  }

  // Timeout
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  init.signal = ctrl.signal;

  // Fetch naar upstream
  let status = 200;
  let payload;

  try {
    const r = await fetch(UPSTREAM + qs, init);
    status = r.status;

    // Probeer JSON
    try {
      payload = await r.json();
    } catch {
      const txt = await r.text().catch(()=>''); // HTML of tekst-fout
      payload = { ok:false, proxy:'html-fallback', status:r.status, statusText:r.statusText, body: String(txt).slice(0, 800) };
    }

    // Normaliseer naar array of {items:[]}
    const normalized = Array.isArray(payload) ? payload
                      : (Array.isArray(payload.items) ? payload
                      : (Array.isArray(payload.logs) ? { items: payload.logs } : { items: [] , error: payload }));

    clearTimeout(tm);
    return new Response(JSON.stringify(normalized), { status: 200, headers: CORS });
  } catch (e) {
    clearTimeout(tm);
    payload = { ok:false, proxy:'exception', error: String(e && e.message ? e.message : e) };
    return new Response(JSON.stringify({ items: [], error: payload }), { status: 200, headers: CORS });
  }
};
