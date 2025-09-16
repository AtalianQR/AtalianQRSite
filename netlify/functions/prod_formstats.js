// ==============================
// FILE 1/2: netlify/functions/prod_formstats.js
// Doel: API uitbreiden met 4-balken-tijdslijn per dag + detailregels met tijden en doorlooptijd
// ==============================

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

  const today = new Date();
  const defFrom = iso(addDays(today, -30));
  const defTo   = iso(today);
  const from = (url.searchParams.get('from') ?? defFrom).slice(0, 10);
  const to   = (url.searchParams.get('to')   ?? defTo).slice(0, 10);
  const code = (url.searchParams.get('code') ?? '').trim();
  const debug = url.searchParams.get('debug') === '1';
  const view  = (url.searchParams.get('view') || '').trim();

  try {
    const store = createStore();
    const prefix = code ? `${code}/` : '';

    // 1) keys ophalen
    const { blobs } = await store.list({ prefix });
    const ndjsonKeys = [];
    const jsonEventKeys = [];
    for (const { key } of blobs) {
      const mA = key.match(/^[^/]+\/(?<day>\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (mA) {
        const day = mA.groups.day;
        if (day >= from && day <= to) ndjsonKeys.push(key);
        continue;
      }
      const mB = key.match(/^[^/]+\/(?<day>\d{4}-\d{2}-\d{2})\/\d{13}-[a-z0-9]{6}\.json$/i);
      if (mB) {
        const day = mB.groups.day;
        if (day >= from && day <= to) jsonEventKeys.push(key);
      }
    }

    if (debug && view === 'keys') {
      return json({ ok:true, from, to, code, ndjsonKeys, jsonEventKeys });
    }

    // 2) Events inlezen en aggregeren
    // dayMap: day -> { perKey: Map(entKey -> {type,id,firstOpen,firstSubmit,desc}), list: [raw events] }
    const dayMap = new Map();

    // helper om events te verwerken (oud & nieuw formaat)
    const handleEvent = (ev) => aggregateEvent(dayMap, ev, from, to);

    // 2A) NDJSON
    for (const key of ndjsonKeys) {
      const text = await store.get(key, { type: 'text' });
      if (!text) continue;
      for (const line of text.split('\n')) {
        const s = line.trim(); if (!s) continue;
        let ev; try { ev = JSON.parse(s); } catch { continue; }
        handleEvent(ev);
      }
    }
    // 2B) 1-event-per-bestand
    for (const key of jsonEventKeys) {
      const s = await store.get(key, { type: 'text' });
      if (!s) continue;
      let ev; try { ev = JSON.parse(s); } catch { continue; }
      handleEvent(ev);
    }

    // 3) Uitvoer samenstellen per dag
    const dates = enumerateDays(from, to);
    const daily = dates.map((d) => {
      const bucket = dayMap.get(d) || { perKey:new Map(), list:[] };

      // detailregels: sorteer op firstOpen
      const details = Array.from(bucket.perKey.values())
        .sort((a,b) => (a.firstOpen||'').localeCompare(b.firstOpen||''))
        .map((x) => ({
          id: x.id,
          type: x.type, // 'equip' | 'space'
          description: x.desc || '',
          time_open: x.firstOpen || null,
          time_submit: x.firstSubmit || null,
          delta_seconds: (x.firstOpen && x.firstSubmit) ? Math.max(0, Math.floor((new Date(x.firstSubmit) - new Date(x.firstOpen))/1000)) : null
        }));

      // tellingen voor 4-balken
      let equip_opened=0, equip_forwarded=0, space_opened=0, space_forwarded=0;
      for (const v of bucket.perKey.values()) {
        const isEq = v.type === 'equip';
        const opened = Boolean(v.firstOpen);
        const fwd    = Boolean(v.firstSubmit);
        if (isEq) {
          equip_opened   += opened ? 1 : 0;
          equip_forwarded+= fwd    ? 1 : 0;
        } else {
          space_opened   += opened ? 1 : 0;
          space_forwarded+= fwd    ? 1 : 0;
        }
      }

      return {
        date: d,
        timeline: { equip_opened, equip_forwarded, space_opened, space_forwarded },
        details
      };
    });

    // Ook een "counts"-array voorzien voor backward-compat, maar nu 4 waarden
    const counts = daily.map((d) => [
      d.date,
      d.timeline.equip_opened,
      d.timeline.equip_forwarded,
      d.timeline.space_opened,
      d.timeline.space_forwarded
    ]);

    return json({ ok:true, from, to, daily, counts });

  } catch (err) {
    const payload = { ok:false, error:'internal', message:String(err?.message||err) };
    return new Response(JSON.stringify(payload), { status:500, headers: { ...headers, 'content-type':'application/json' } });
  }
};

// ===== helpers =====
function createStore() {
  try { return getStore('formlog'); }
  catch (e) {
    if (String(e?.name||e).includes('MissingBlobsEnvironmentError')) {
      const siteID = process.env.NETLIFY_SITE_ID || process.env.NF_SITE_ID;
      const token  = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
      if (siteID && token) return getStore('formlog', { siteID, token });
    }
    throw e;
  }
}
function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(), 'content-type':'application/json' } });
}
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
  const out=[]; for(let t=A.getTime(); t<=B.getTime(); t+=86400000){ out.push(new Date(t).toISOString().slice(0,10)); }
  return out;
}

// Aggregatie: bewaar earliest open en earliest submit per entiteit per dag
function aggregateEvent(dayMap, ev, from, to){
  const day = String(ev.ts_server || ev.ts || '').slice(0,10);
  if (!day || day < from || day > to) return;

  const code = String(ev.code ?? '');
  const id   = String(ev.id   ?? code);
  if (!id) return;

  const type = ev.isEquipment ? 'equip' : 'space';
  const keyEnt = `${type}|${id}`;

  let bucket = dayMap.get(day);
  if (!bucket) { bucket = { perKey:new Map(), list:[] }; dayMap.set(day,bucket); }

  const isoTs = toIso(ev.ts_server || ev.ts);
  const desc  = String(ev.description || ev.Description || ev.desc || '');

  let rec = bucket.perKey.get(keyEnt);
  if (!rec) { rec = { type, id, firstOpen:null, firstSubmit:null, desc }; bucket.perKey.set(keyEnt, rec); }
  if (desc && !rec.desc) rec.desc = desc; // vul aan indien later beschikbaar

  if (ev.type === 'url_load') {
    if (!rec.firstOpen || isoTs < rec.firstOpen) rec.firstOpen = isoTs;
  }
  if (ev.type === 'submit_success') {
    if (!rec.firstSubmit || isoTs < rec.firstSubmit) rec.firstSubmit = isoTs;
  }
}
function toIso(x){
  try {
    if (!x) return null;
    if (typeof x === 'string' && /T/.test(x)) return x;
    if (typeof x === 'number') return new Date(x).toISOString();
    const d = new Date(x); return isNaN(d) ? null : d.toISOString();
  } catch { return null; }
}


