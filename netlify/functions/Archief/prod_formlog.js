// netlify/functions/prod_formlog.js
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  if (method === 'HEAD' || method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (method === 'GET')    return json({ ok: true }, 200);
  if (method !== 'POST')   return new Response('Method Not Allowed', { status: 405, headers: cors() });

  let data = {};
  try { data = await req.json(); } catch { return new Response(null, { status: 204, headers: cors() }); }

  const now  = new Date();
  const day  = now.toISOString().slice(0, 10);

  // ⚠️ forceer strings, behoud leading zeros
  const code = String(data.code ?? 'unknown');
  const id   = String(data.id   ?? code);

  // 🔑 nieuw sleutelpatroon: <code>/<YYYY-MM-DD>/<ts>-<rand>.json
  const ts   = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key  = `${code}/${day}/${ts}-${rand}.json`;

  try {
    const store = getStore('formlog'); // v2 + binnen handler
    const payload = {
      ...data,
      code, id,
      ts,                   // numeriek
      ts_server: now.toISOString(), // ISO
      ua: req.headers.get('user-agent') || '',
      ip: req.headers.get('x-forwarded-for') || ''
    };
    await store.set(key, JSON.stringify(payload), {
      contentType: 'application/json'
    });

    if (url.searchParams.get('debug') === '1') {
      return json({ ok: true, key }, 200);
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
function json(obj, status){
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(), 'content-type': 'application/json' } });
}
