// netlify/functions/prod_formlog.js
import { getStore } from '@netlify/blobs';

export default async (req, ctx) => {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  if (method === 'HEAD' || method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (method === 'GET')    return json({ ok: true }, 200);

  if (method !== 'POST')   return new Response('Method Not Allowed', { status: 405, headers: cors() });

  let data = {};
  try { data = await req.json(); } catch { return new Response(null, { status: 204, headers: cors() }); }

  const now  = new Date();
  const code = String(data.code || 'unknown').slice(0, 64);
  const day  = now.toISOString().slice(0, 10);
  const key  = `${code}/${day}.ndjson`;

  try {
    const store = getStore('formlog');       // ✅ v2-injectie + binnen de handler
    const line  = JSON.stringify({
      ...data,
      ts_server: now.toISOString(),
      ua: req.headers.get('user-agent') || '',
      ip: req.headers.get('x-forwarded-for') || ''
    });
    await store.append(key, line + '\n');

    if (url.searchParams.get('debug') === '1') {
      return json({ ok: true, key, bytes: (line + '\n').length }, 200);
    }
  } catch (err) {
    console.error('formlog error:', err);
    if (url.searchParams.get('debug') === '1') return json({ ok: false, error: String(err) }, 500);
  }

  return new Response(null, { status: 204, headers: cors() });
};

function cors(){ return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};}
function json(obj, status){ return new Response(JSON.stringify(obj), { status, headers: { ...cors(), 'content-type': 'application/json' } }); }
