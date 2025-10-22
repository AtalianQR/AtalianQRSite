// netlify/functions/formlog.js
import { getStore } from '@netlify/blobs';

const WORKER_URL = 'https://atalian-logs.atalianqr.workers.dev/api/log';
const DUAL_WRITE_TO_BLOBS = true; // enkel actief in productie

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

export async function handler(event) {
  const method = event.httpMethod?.toUpperCase() || 'GET';
  if (method === 'HEAD' || method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders };
  if (method === 'GET') return json(200, { ok: true, hint: 'POST JSON telemetry to this endpoint' });
  if (method !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 204, headers: corsHeaders }; }

  const now = new Date();
  const ts = Date.now();
  const code = String(data.code ?? 'unknown');
  const id = String(data.id ?? code);

  const payload = {
    ...data,
    code, id,
    ts,
    ts_server: now.toISOString(),
    ua: event.headers['user-agent'] || '',
    ip: event.headers['x-forwarded-for'] || ''
  };

  // Enkel loggen in productie
  const isProd = process.env.CONTEXT === 'production';

  if (isProd) {
    try {
      const r = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        cache: 'no-store',
        keepalive: false
      });
      console.log('Worker POST status:', r.status);
      if (!r.ok) console.error('Worker POST failed:', r.status, await r.text().catch(() => ''));
    } catch (err) {
      console.error('Worker POST error:', err);
    }

    if (DUAL_WRITE_TO_BLOBS) {
      try {
        const store = getStore('formlog');
        const day = now.toISOString().slice(0, 10);
        const rand = Math.random().toString(36).slice(2, 8);
        const key = `${code}/${day}/${ts}-${rand}.json`;
        await store.set(key, JSON.stringify(payload), { contentType: 'application/json' });
      } catch (err) {
        console.error('Blobs write error:', err);
      }
    }
  } else {
    console.log(`[TEST MODE] Logging uitgeschakeld voor code ${code}`);
  }

  return { statusCode: 204, headers: corsHeaders };
}
