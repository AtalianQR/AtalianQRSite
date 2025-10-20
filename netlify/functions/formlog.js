// netlify/functions/formlog.js
import { getStore } from '@netlify/blobs';

const WORKER_URL = 'https://atalian-logs.atalianqr.workers.dev/api/log'; // ← jouw statsbron
const DUAL_WRITE_TO_BLOBS = true; // op false zetten als je geen backup wil

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
  if (method === 'GET')    return json(200, { ok: true, hint: 'POST JSON telemetry to this endpoint' });
  if (method !== 'POST')   return json(405, { error: 'Method Not Allowed' });

  // Safe parse
  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 204, headers: corsHeaders }; }

  const now = new Date();
  const ts  = Date.now();
  const code = String(data.code ?? 'unknown');
  const id   = String(data.id   ?? code);

  // Verrijk payload (serverzijde stempel)
  const payload = {
    ...data,
    code, id,
    ts,                             // numeriek
    ts_server: now.toISOString(),   // ISO
    ua: event.headers['user-agent'] || '',
    ip: event.headers['x-forwarded-for'] || ''
  };

  // 1) Doorposten naar Cloudflare Worker (bron voor jouw statsportal)
  try {
    const r = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      cache: 'no-store',
      keepalive: false
    });
  // Worker mag 2xx (200/204) geven; geen body vereist
	console.log('Worker POST status:', r.status); // <--- DE NIEUWE LIJN!
	if (!r.ok) {
      const txt = await r.text().catch(()=>'');
      console.error('Worker POST failed:', r.status, txt);
      // We geven 202 terug zodat de portal niet blokkeert, maar log wél fout.
    }
  } catch (err) {
    console.error('Worker POST error:', err);
  }

  // 2) (Optioneel) Dual-write naar Netlify Blobs voor archief
  if (DUAL_WRITE_TO_BLOBS) {
    try {
      const store = getStore('formlog'); // vereist @netlify/blobs en store-config
      const day   = now.toISOString().slice(0, 10);
      const rand  = Math.random().toString(36).slice(2, 8);
      const key   = `${code}/${day}/${ts}-${rand}.json`;
      await store.set(key, JSON.stringify(payload), { contentType: 'application/json' });
    } catch (err) {
      console.error('Blobs write error:', err);
    }
  }

  // Altijd 204 terug (beacon/fetch keepalive vriendelijk)
  return { statusCode: 204, headers: corsHeaders };
}
