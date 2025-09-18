// netlify/functions/logs.js
// Proxy naar Cloudflare Worker met method/body-forwarding, timeout en duidelijke fouten.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

// Pas aan indien nodig:
const UPSTREAM = 'https://atalian-logs.atalianqr.workers.dev/api/log';
const TIMEOUT_MS = 8000;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const u = new URL(req.url);
  const qs = u.search || '';
  const method = req.method.toUpperCase();

  // Body enkel meesturen bij niet-GET
  const init = {
    method,
    headers: {
      // minimaal deze twee; voeg door wat je nodig hebt
      'Accept': 'application/json',
      'Content-Type': req.headers.get('Content-Type') || 'application/json'
    }
  };
  if (method !== 'GET' && method !== 'HEAD') {
    const bodyText = await req.text().catch(() => '');
    init.body = bodyText;
  }

  // Timeout (AbortController)
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  init.signal = ctrl.signal;

  try {
    const r = await fetch(UPSTREAM + qs, init);
    const text = await r.text().catch(() => '');

    // geef upstream status door, maar altijd met voorspelbare headers
    return new Response(text, { status: r.status, headers: CORS });
  } catch (e) {
    const payload = { ok: false, code: 'PROXY_ERROR', message: e?.message || String(e) };
    return new Response(JSON.stringify(payload), { status: 502, headers: CORS });
  } finally {
    clearTimeout(t);
  }
};
