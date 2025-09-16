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

      // detailregels: flatten ALLE occurrences en sorteer op open (fallback submit)
      const details = Array.from(bucket.perKey.values())
        .flatMap((rec) => (rec.occ||[]).map(o => ({
          id: rec.id,
          type: rec.type,
          description: rec.desc || '',
          time_open: o.open || null,
          time_submit: o.submit || null,
          delta_seconds: (o.open && o.submit) ? Math.max(0, Math.floor((new Date(o.submit) - new Date(o.open))/1000)) : null
        })))
        .sort((a,b)=>{
          const ka = a.time_open || a.time_submit || '';
          const kb = b.time_open || b.time_submit || '';
          return ka.localeCompare(kb);
        });

      // tellingen voor 4-balken: PER OCCURRENCE
      let equip_opened=0, equip_forwarded=0, space_opened=0, space_forwarded=0;
      for (const rec of bucket.perKey.values()){
        const isEq = rec.type === 'equip';
        for (const o of (rec.occ||[])){
          if (isEq){
            if (o.open)   equip_opened++;
            if (o.submit) equip_forwarded++;
          } else {
            if (o.open)   space_opened++;
            if (o.submit) space_forwarded++;
          }
        }
      }

      return { date: d, timeline: { equip_opened, equip_forwarded, space_opened, space_forwarded }, details };
    });

    // backward-compat counts (4 waarden)
    const counts = daily.map((d) => [ d.date, d.timeline.equip_opened, d.timeline.equip_forwarded, d.timeline.space_opened, d.timeline.space_forwarded ]);

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

// Aggregatie: registreer ALLE oproepen per entiteit per dag en koppel eerste volgende submit
function aggregateEvent(dayMap, ev, from, to){
  const isoTs = toIso(ev.ts_server || ev.ts);
  if (!isoTs) return;
  const day = toLocalDateISO(isoTs, 'Europe/Brussels');
  if (!day || day < from || day > to) return;

  const code = String(ev.code ?? '');
  const id   = String(ev.id   ?? code);
  if (!id) return;

  const type = ev.isEquipment ? 'equip' : 'space';
  const keyEnt = `${type}|${id}`;

  let bucket = dayMap.get(day);
  if (!bucket) { bucket = { perKey:new Map(), list:[] }; dayMap.set(day,bucket); }

  const desc  = String(ev.description || ev.Description || ev.desc || '');

  let rec = bucket.perKey.get(keyEnt);
  if (!rec) { rec = { type, id, desc:'', occ:[] }; bucket.perKey.set(keyEnt, rec); }
  if (desc && !rec.desc) rec.desc = desc; // aanvullen indien later bekend

  if (ev.type === 'url_load') {
    // elke "open" is een NIEUWE occurrence
    rec.occ.push({ open: isoTs, submit: null });
  }
  if (ev.type === 'submit_success') {
    // koppel aan eerste occurrence zonder submit met open <= submit
    const dtSubmit = new Date(isoTs).getTime();
    let linked = false;
    for (const o of rec.occ) {
      const tOpen = o.open ? new Date(o.open).getTime() : null;
      if (!o.submit && tOpen!=null && tOpen <= dtSubmit) {
        o.submit = isoTs; linked = true; break;
      }
    }
    if (!linked) {
      // vangnet: er was geen open; registreer losse submit
      rec.occ.push({ open: null, submit: isoTs });
    }
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
function toLocalDateISO(ts, tz='Europe/Brussels'){
  try{
    const d = new Date(ts);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit'
    }).format(d); // YYYY-MM-DD
  } catch {
    return String(ts).slice(0,10);
  }
}



