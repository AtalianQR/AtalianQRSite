// netlify/functions/proxy_logs.js
export default async (req, context) => {
  const origin = req.headers.get('origin') || '*'; // strakker: whitelisten je Netlify-origin
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const base = 'https://atalian-logs.atalianqr.workers.dev/api/log';
  const url = new URL(req.url);
  const limit = url.searchParams.get('limit') ?? '8000';
  const target = `${base}?limit=${encodeURIComponent(limit)}`;

  try {
    if (req.method === 'GET') {
      const res = await fetch(target, { method: 'GET', headers: { 'Cache-Control': 'no-store' } });
      const body = await res.text();
      return new Response(body, { status: res.status, headers: { ...cors, 'Content-Type': res.headers.get('content-type') || 'application/json' } });
    }
    if (req.method === 'POST') {
      const body = await req.text();
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const txt = await res.text();
      return new Response(txt, { status: res.status, headers: { ...cors, 'Content-Type': res.headers.get('content-type') || 'application/json' } });
    }
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  } catch (e) {
    return new Response(`Proxy error: ${e.message}`, { status: 502, headers: cors });
  }
};
