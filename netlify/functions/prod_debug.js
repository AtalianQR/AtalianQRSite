// netlify/functions/prod_debug.js
import { getStore } from '@netlify/blobs';

export default async (req, ctx) => {
  try {
    const u = new URL(req.url);
    const code = (u.searchParams.get('code') || '').trim();
    const prefix = code ? `${code}/` : '';

    const store = getStore('formlog');   // ✅ v2 + binnen handler
    const { blobs } = await store.list({ prefix });

    const items = [];
    for (const { key, size } of blobs.slice(-10)) {
      const text  = await store.get(key, { type: 'text' });
      const lines = (text || '').trim().split('\n');
      const tail  = lines.slice(-3).map(s => { try { return JSON.parse(s); } catch { return s; }});
      items.push({ key, size, tail });
    }

    return json({ ok: true, prefix, count: blobs.length, items }, 200);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
};

function json(obj, status){ return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
