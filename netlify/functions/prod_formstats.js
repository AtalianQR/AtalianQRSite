// ESM Netlify Function – aggregatie voor statsportal
// Doel: per dag lijst van entiteiten (ruimte/installatie) die
//  - opgeroepen werden (opened)
//  - doorgestuurd werden naar Ultimo (submitted)
// Bron: events gelogd door portal.html naar Blobs-store "formlog"
//  * opened     ← type === 'url_load' (met id)
//  * submitted  ← type === 'submit_success' (met id)
//
// Query parameters:
//   from=YYYY-MM-DD   (optioneel; default = vandaag-30)
//   to=YYYY-MM-DD     (optioneel; default = vandaag)
//   code=...          (optioneel; filter op één QR-code; anders ALLE codes)
//   view=by_day_entities  (default)
//
// Response shape (view=by_day_entities):
//   { ok:true, from, to, daily:[{date, opened:[{id,type}], submitted:[{id,type}]}] }
//
// Gezondheidschecks: HEAD/OPTIONS → 204, GET zonder data → lege dagen

import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  try {
    const method = (event.httpMethod || '').toUpperCase();
    if (method === 'HEAD' || method === 'OPTIONS') {
      return { statusCode: 204, headers: cors() };
    }
    if (method !== 'GET') {
      return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
    }

    const qs = event.queryStringParameters || {};
    const today = new Date();
    const defFrom = iso(addDays(today, -30));
    const defTo = iso(today);
    const from = (qs.from || defFrom).slice(0,10);
    const to   = (qs.to   || defTo).slice(0,10);
    const view = (qs.view || 'by_day_entities');
    const code = (qs.code || '').trim(); // optioneel

    // 1) Haal keys op uit Blobs (correct gebruik van list)
    const store = getStore('formlog');
    const keys = [];
    const prefix = code ? `${code}/` : '';
    // Optie A: simpel (alle resultaten in 1 keer)
    const { blobs } = await store.list({ prefix });
    for (const { key } of blobs) {
      const m = key.match(/^(?<code>[^/]+)\/(?<day>\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (!m) continue;
      const day = m.groups.day;
      if (day >= from && day <= to) keys.push(key);
    }
    // (Alternatief bij véél keys: paginate:true en per page itereren – zie Netlify docs)

    // 2) Parse NDJSON per key en aggregeer per dag
    const dayMap = new Map(); // date -> { opened:Set<string>, submitted:Set<string>, byKey:Map }

    for (const key of keys) {
      const text = await store.get(key, { type: 'text' });
      if (!text) continue;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const day = (ev.ts_server || ev.ts || '').slice(0,10);
        if (!day || day < from || day > to) continue;

        const id  = ev.id || '';
        if (!id) continue; // we tellen enkel events met entiteit-id
        const type = ev.isEquipment ? 'equip' : (ev.typeStr || ev.type === 'space') ? 'space' : (ev.isEquipment===false ? 'space' : 'unknown');
        const keyEnt = `${type}|${id}`;

        const bucket = ensureDay(dayMap, day);

        // opened: elk URL-bezoek met id
        if (ev.type === 'url_load') {
          bucket.opened.add(keyEnt);
        }
        // submitted: ingestuurde melding
        if (ev.type === 'submit_success') {
          bucket.submitted.add(keyEnt);
        }
      }
    }

    // 3) Maak volledige dag-range (ook lege dagen) en bouw resultaat
    const dates = enumerateDays(from, to);
    const daily = dates.map(d => {
      const b = dayMap.get(d) || { opened:new Set(), submitted:new Set() };
      // opened-only = opened \ submitted
      const openedOnly = arrayDiff([...b.opened], b.submitted);
      return {
        date: d,
        opened: openedOnly.map(k => toEnt(k)),
        submitted: [...b.submitted].map(k => toEnt(k))
      };
    });

    const body = JSON.stringify({ ok:true, from, to, daily });
    return { statusCode: 200, headers: { ...cors(), 'content-type':'application/json' }, body };

  } catch (err) {
    console.error('prod_formstats error', err);
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ ok:false, error:'internal' }) };
  }
};

// ===== helpers =====
function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function iso(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function enumerateDays(from,to){
  const A = new Date(from+'T00:00:00Z');
  const B = new Date(to  +'T00:00:00Z');
  const out=[];
  for(let t=A.getTime(); t<=B.getTime(); t+=86400000){
    out.push(new Date(t).toISOString().slice(0,10));
  }
  return out;
}
function ensureDay(map, day){
  let b = map.get(day);
  if (!b){ b = { opened:new Set(), submitted:new Set() }; map.set(day,b); }
  return b;
}
function toEnt(k){
  const [type,id] = k.split('|');
  return { id, type };
}
function arrayDiff(arr, setB){
  const out=[]; for(const k of arr){ if(!setB.has(k)) out.push(k); } return out;
}
