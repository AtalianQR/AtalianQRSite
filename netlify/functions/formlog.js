// netlify/functions/formlog.js — Netlify Functions v2
// v2 is nodig zodat NETLIFY_BLOBS_CONTEXT beschikbaar is voor @netlify/blobs

import { getStore } from '@netlify/blobs';

const DUAL_WRITE_TO_BLOBS = true;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async (req) => {
  const method = req.method?.toUpperCase() || 'GET';
  if (method === 'HEAD' || method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (method === 'GET') return new Response(JSON.stringify({ ok: true, hint: 'POST JSON telemetry to this endpoint' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: cors });

  let data = {};
  try { data = await req.json(); }
  catch { return new Response(null, { status: 204, headers: cors }); }

  const now  = new Date();
  const ts   = Date.now();
  const code = String(data.code ?? 'unknown');
  const id   = String(data.id ?? code);

  const payload = {
    ...data,
    code, id, ts,
    ts_server: now.toISOString(),
    ua: req.headers.get('user-agent') || '',
    ip: req.headers.get('x-forwarded-for') || ''
  };

  const isProd = process.env.CONTEXT === 'production';

  if (isProd && DUAL_WRITE_TO_BLOBS) {
    try {
      const store = getStore('formlog');
      const day  = now.toISOString().slice(0, 10);
      const rand = Math.random().toString(36).slice(2, 8);
      const key  = `${code}/${day}/${ts}-${rand}.json`;
      await store.set(key, JSON.stringify(payload), { contentType: 'application/json' });
    } catch (err) {
      console.error('Blobs write error:', err);
    }
  } else if (!isProd) {
    console.log(`[TEST MODE] Logging uitgeschakeld voor code ${code}`);
  }

  return new Response(null, { status: 204, headers: cors });
};
