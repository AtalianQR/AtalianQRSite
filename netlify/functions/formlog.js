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

  // Bewust GEEN IP-adres en GEEN user-agent: de telemetrie dient enkel voor
  // flow-analyse (waar haken gebruikers af, welke taal, welke dienst) en heeft
  // daarvoor geen herleidbaar kenmerk nodig. Het IP identificeert rechtstreeks;
  // de user-agent is een fingerprint-vector in combinatie met tijdstip en code.
  // Zonder beide is dit geen persoonsgegeven en vervalt de discussie over
  // bewaartermijnen. Misbruikpreventie hoort in een tempolimiet, niet hier.
  // Taal blijft wel bewaard: drie mogelijke waarden, niet identificerend, en
  // nodig om NL/FR/EN-uitval tegen elkaar af te wegen.
  const payload = {
    ...data,
    code, id, ts,
    ts_server: now.toISOString()
  };

  if (DUAL_WRITE_TO_BLOBS) {
    try {
      const store = getStore('formlog');
      const day  = now.toISOString().slice(0, 10);
      const rand = Math.random().toString(36).slice(2, 8);
      // Type in de key opnemen zodat read_logs.js op type kan filteren zonder
      // elke blob te moeten downloaden (anders verdrinkt url_load in de stap-events).
      const type = String(data.type ?? 'event').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || 'event';
      const key  = `${code}/${day}/${ts}-${type}-${rand}.json`;
      await store.set(key, JSON.stringify(payload), { contentType: 'application/json' });
    } catch (err) {
      console.error('Blobs write error:', err);
    }
  }

  return new Response(null, { status: 204, headers: cors });
};
