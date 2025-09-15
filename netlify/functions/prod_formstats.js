// netlify/functions/prod_formstats.js
import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = cors();
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  if (method === 'HEAD' || method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }
  if (method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers });
  }

  // querystring
  const today = new Date();
  const defFrom = iso(addDays(today, -30));
  const defTo   = iso(today);
  const from = (url.searchParams.get('from') ?? defFrom).slice(0, 10);
  const to   = (url.searchParams.get('to')   ?? defTo).slice(0, 10);
  const code = (url.searchParams.get('code') ?? '').trim();
  const debug = url.searchParams.get('debug') === '1';

  try {
    const store = getStore('formlog');
    const prefix = code ? `${code}/` : '';

    // 1) keys ophalen (list → { blobs })
    const { blobs } = await store.list({ prefix });
    const keys = [];
    for (const { key } of blobs) {
      const m = key.match(/^(?<code>[^/]+)\/(?<day>\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (!m) continue;
      const day = m.groups.day;
      if (day >= from && day <= to) keys.push(key);
    }

    // 2) NDJSON per key inlezen en aggregeren
    const dayMap = new Map(); // day -> { opened:Set, submitted:Set }
    for (const key of keys) {
      const text = await store.get(key, { type: 'text' });
      if (!text) continue;
      for (const line of text.split('\n')) {
        const s = line.trim(); if (!s) continue;
        let ev; try { ev = JSON.parse(s); } catch { continue; }

        const day = String(ev.ts_server || ev.ts || '').slice(0, 10);
        if (!day || day < from || day > to) continue;

        const id = ev.id || ''; if (!id) continue;
        const type = ev.isEquipment ? 'equip'
                    : (ev.typeStr || ev.type === 'space') ? 'space'
                    : (ev.isEquipment === false) ? 'space' : 'unknown';
        const keyEnt = `${type}|${id}`;

        const bucket = ensureDay(dayMap, day);
        if (ev.type === 'url_load') bucket.opened.add(keyEnt);
        if (ev.type === 'submit_success') bucket.submitted.add(keyEnt);
      }
    }

    // 3) volledige daterange + output shape
    const dates = enumerateDays(from, to);
    const daily = dates.map(d => {
      const b = dayMap.get(d) || { opened: new Set(), submitted: new Set() };
      const openedOnly = arrayDiff([...b.opened], b.submitted);
      return {
        date: d,
        opened: openedOnly.map(toEnt),
        submitted: [...b.submitted].map(toEnt),
      };
    });

    const body = JSON.stringify({ ok: true, from, to, daily });
    return new Response(body, { status: 200, headers: { ...headers, 'content-type': 'application/json' } });

  } catch (err) {
    // ✳︎ debug=1 toont de foutinhoud direct
    const payload = { ok: false, error: 'internal', message: String(err?.message || err) };
    return new Response(JSON.stringify(debug ? payload : { ok:false, error:'internal' }),
      { status: 500, headers: { ...headers, 'content-type': 'application/json' } });
  }
};

// ===== helpers =====
function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function iso(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function enumerateDays(from,to){
  const A = new Date(from+'T00:00:00Z');
  const B = new Date(to  +'T00:00:00Z');
  const out=[]; for(let t=A.getTime(); t<=B.getTime(); t+=86400000){
    out.push(new Date(t).toISOString().slice(0,10));
  } return out;
}
function ensureDay(map, day){
  let b = map.get(day);
  if(!b){ b = { opened:new Set(), submitted:new Set() }; map.set(day,b); }
  return b;
}
function toEnt(k){ const [type,id] = k.split('|'); return { id, type }; }
function arrayDiff(arr, setB){ const out=[]; for(const k of arr){ if(!setB.has(k)) out.push(k); } return out; }
