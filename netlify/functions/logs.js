// netlify/functions/logs.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

const UPSTREAM = 'https://atalian-logs.atalianqr.workers.dev/api/log';
const TIMEOUT_MS = 8000;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Query + method/body doorsturen
  const u = new URL(req.url);
  const qs = u.search || '';
  const init = {
    method: req.method,
    headers: { 'Accept':'application/json', 'Content-Type': req.headers.get('Content-Type') || 'application/json' }
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text().catch(()=> '');
  }

  // Timeout
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  init.signal = ctrl.signal;

  try {
    const r = await fetch(UPSTREAM + qs, init);

    // 👇 Normaliseer ALLE antwoorden naar JSON (ook HTML error pages)
    let payload;
    try { payload = await r.json(); }
    catch {
      const txt = await r.text().catch(()=> '');
      payload = { ok:false, proxy:'html-fallback', status:r.status, statusText:r.statusText, body: txt.slice(0,600) };
    }

    return new Response(JSON.stringify(payload), { status: r.ok ? 200 : 200, headers: CORS });
    // ^ We geven status 200 terug met {ok:fal
