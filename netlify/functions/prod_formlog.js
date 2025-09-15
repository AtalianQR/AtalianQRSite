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
    const store = getStore('formlog'); // v2 + binnen handler
    const line  = JSON.stringify({
      ...data,
      ts_server: now.toISOString(),
      ua: req.headers.get('user-agent') || '',
      ip: req.headers.get('x-forwarded-for') || ''
    }) + '\n';

    // ---- NDJSON append zonder append() ----
    // 1) Probeer aanmaken als nieuw
    let wrote = false;
    const created = await store.set(key, line, { onlyIfNew: true });
    if (created?.modified) {
      wrote = true;
    } else {
      // 2) Bestond al → optimistische append met ETag (max 3 pogingen)
      for (let i = 0; i < 3 && !wrote; i++) {
        const cur = await store.getWithMetadata(key, { type: 'text' });
        const prev = cur?.data || '';
        const etag = cur?.metadata?.etag;
        const next = prev + line;
        const res = await store.set(key, next, { onlyIfMatch: etag });
        wrote = !!res?.modified;
      }
      // 3) Laatste redmiddel (heel klein race-risico): onvoorwaardelijk overschrijven
      if (!wrote) {
        const prev = (await store.get(key, { type: 'text' })) || '';
        await store.set(key, prev + line);
      }
    }

    if (url.searchParams.get('debug') === '1') {
      return json({ ok: true, key, bytes: line.length }, 200);
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
