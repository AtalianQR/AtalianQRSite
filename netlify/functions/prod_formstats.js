// netlify/functions/prod_formstats.js
// Volledige, robuuste versie met concurrency, timeouts, debug en meerdere "views"
import { getStore } from '@netlify/blobs';

/*
  Query parameters:
    from=YYYY-MM-DD        // verplicht
    to=YYYY-MM-DD          // verplicht
    view=summary|keys|raw  // default: summary
    groupBy=event          // enkel bij view=summary (anders genegeerd)
    debug=1                // timings & counters in response
    concurrency=8          // max parallel reads (1..16)
    maxDays=31             // cap op aantal dagen in range
    maxFiles=5000          // cap op aantal bestanden die we lezen
*/

export default async (req) => {
  const tStart = Date.now();
  const url = new URL(req.url);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };

  // --- CORS / method guards ---
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return respond({ ok:false, msg:'Method Not Allowed' }, 405, headers);

  // --- Top-level try/catch zodat we nooit met een kale 502 eindigen ---
  try {
    // ----------------- Params & caps -----------------
    const from = (url.searchParams.get('from') || '').slice(0, 10);
    const to   = (url.searchParams.get('to')   || '').slice(0, 10);
    const view = (url.searchParams.get('view') || 'summary').toLowerCase();
    const groupBy = (url.searchParams.get('groupBy') || '').toLowerCase();
    const debug = url.searchParams.get('debug') === '1';

    const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isIso(from) || !isIso(to) || from > to) {
      return respond({ ok:false, msg:'Invalid date range', from, to }, 400, headers);
    }

    const maxDays = clamp(int(url.searchParams.get('maxDays')), 1, 90, 31);
    const rangeDays = daysBetween(from, to) + 1;
    if (rangeDays > maxDays) {
      return respond({ ok:false, msg:`Range too large (> ${maxDays} days)`, from, to }, 413, headers);
    }

    const concurrency = clamp(int(url.searchParams.get('concurrency')), 1, 16, 8);
    const maxFiles = clamp(int(url.searchParams.get('maxFiles')), 100, 50000, 5000);

    const store = getStore(); // Netlify Blobs

    // ----------------- Keys ophalen -----------------
    const tKeys0 = Date.now();
    const [ndjsonKeys, jsonEventKeys] = await listKeysForRange(store, from, to, maxFiles);
    const tKeys1 = Date.now();

    if (view === 'keys') {
      return respond({
        ok: true, from, to,
        counts: { daily: ndjsonKeys.length, events: jsonEventKeys.length },
        sample: {
          daily: ndjsonKeys.slice(0, 10),
          events: jsonEventKeys.slice(0, 10)
        },
        debug: debug ? { timings_ms: { list_keys: tKeys1 - tKeys0, total: Date.now() - tStart } } : undefined
      }, 200, headers);
    }

    // ----------------- Lezen & aggregeren -----------------
    const tRead0 = Date.now();

    // A) dagen die een NDJSON-bestand hebben
    const ndjsonDays = new Set(ndjsonKeys.map(keyToDayFromNDJSON).filter(Boolean));

    // B) filter losse events van dagen met NDJSON
    const jsonEventKeysFiltered = jsonEventKeys.filter(k => {
      const day = keyToDayFromEvent(k);
      return day ? !ndjsonDays.has(day) : true;
    });

    // C) concurrency helpers
    const withTimeout = (p, ms = 8000) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('upstream-timeout')), ms))
    ]);

    const runPool = async (items, limit, worker) => {
      const queue = [...items];
      const n = Math.min(limit, queue.length);
      const workers = Array.from({ length: n }, async function go() {
        while (queue.length) {
          const item = queue.shift();
          try { await worker(item); } catch { /* slikken: we willen door */ }
        }
      });
      await Promise.all(workers);
    };

    // D) aggregatiecontainers
    const dayMap = new Map();        // day -> { total, byEvent, withPhoto, urgent }
    const rawItems = [];             // indien view=raw

    const handleEvent = (ev) => {
      if (view === 'raw') { rawItems.push(ev); return; }
      aggregateEvent(dayMap, ev, from, to, groupBy === 'event');
    };

    // E) NDJSON parallel lezen
    let linesRead = 0;
    await runPool(ndjsonKeys, concurrency, async (key) => {
      const txt = await withTimeout(store.get(key, { type: 'text' }), 8000);
      if (!txt) return;
      for (const line of txt.split('\n')) {
        const s = line.trim(); if (!s) continue;
        const obj = safeJSON(s); if (!obj) continue;
        handleEvent(obj);
        linesRead++;
      }
    });

    // F) losse JSON events parallel lezen
    let eventFilesRead = 0;
    await runPool(jsonEventKeysFiltered.slice(0, maxFiles), concurrency, async (key) => {
      const s = await withTimeout(store.get(key, { type: 'text' }), 6000);
      if (!s) return;
      const obj = safeJSON(s); if (!obj) return;
      handleEvent(obj);
      eventFilesRead++;
    });

    const tRead1 = Date.now();

    // ----------------- Output -----------------
    let payload;
    if (view === 'raw') {
      payload = { ok:true, from, to, count: rawItems.length, items: rawItems };
    } else {
      const days = [...dayMap.keys()].sort();
      const items = days.map(d => ({ day: d, ...dayMap.get(d) }));
      payload = { ok:true, from, to, items };
    }

    if (debug) {
      payload.debug = {
        counts: {
          keys_daily: ndjsonKeys.length,
          keys_events: jsonEventKeys.length,
          ndjson_lines_read: linesRead,
          json_event_files_read: eventFilesRead
        },
        limits: { maxDays, maxFiles, concurrency },
        timings_ms: {
          list_keys: tKeys1 - tKeys0,
          read_aggregate: tRead1 - tRead0,
          total: Date.now() - tStart
        }
      };
    }

    return respond(payload, 200, headers);

  } catch (e) {
    // Duidelijke fout in UI i.p.v. kale 502
    return respond({
      ok: false,
      error: e?.name || 'Error',
      message: e?.message || String(e),
      elapsed_ms: Date.now() - tStart
    }, 502, headers);
  }
};

/* ------------------ Config / Prefixen ------------------ */
// Pas aan indien jouw structuur anders is:
const PREFIX_DAILY  = 'daily/';   // daily/2025-09-18.ndjson
const PREFIX_EVENTS = 'events/';  // events/2025-09-18/abc.json

/* ------------------ Helpers ------------------ */

function respond(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

function int(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}
function clamp(n, min, max, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function safeJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00Z').getTime();
  const d2 = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((d2 - d1) / 86400000);
}
function keyToDayFromNDJSON(key) {
  const m = key.match(/^daily\/(\d{4}-\d{2}-\d{2})\.ndjson$/);
  return m ? m[1] : null;
}
function keyToDayFromEvent(key) {
  const m = key.match(/^events\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : null;
}

async function listKeysForRange(store, from, to, maxFiles) {
  // List beide prefixen en filter op dag in de key
  const filterDaily = (k) => {
    const m = k.match(/^daily\/(\d{4}-\d{2}-\d{2})\.ndjson$/);
    return m ? (m[1] >= from && m[1] <= to) : false;
  };
  const filterEvent = (k) => {
    const m = k.match(/^events\/(\d{4}-\d{2}-\d{2})\//);
    return m ? (m[1] >= from && m[1] <= to) : false;
  };

  const ndjsonKeys = await listAll(store, PREFIX_DAILY, filterDaily, Math.min(maxFiles, 10000));
  const jsonEventKeys = await listAll(store, PREFIX_EVENTS, filterEvent, maxFiles);

  // Sort (nieuwste eerst) kan nuttig zijn
  ndjsonKeys.sort().reverse();
  jsonEventKeys.sort().reverse();

  return [ndjsonKeys, jsonEventKeys];
}

async function listAll(store, prefix, predicate, hardCap) {
  const out = [];
  let cursor = undefined;

  while (true) {
    const page = await store.list({ prefix, limit: 500, cursor });
    const blobs = Array.isArray(page?.blobs) ? page.blobs : [];
    for (const { key } of blobs) {
      if (predicate(key)) out.push(key);
      if (hardCap && out.length >= hardCap) return out;
    }
    if (page?.complete || !page?.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

function aggregateEvent(dayMap, ev, from, to, groupByEvent) {
  // timestamp → dag
  const ts = toNumber(ev.server_ts ?? ev.ts ?? Date.now());
  const day = new Date(ts).toISOString().slice(0, 10);
  if (day < from || day > to) return;

  const g = dayMap.get(day) || {
    total: 0,
    withPhoto: 0,
    urgent: 0,
    byEvent: groupByEvent ? {} : undefined
  };
  g.total += 1;
  if (ev.photo) g.withPhoto += 1;
  if (ev.urgent) g.urgent += 1;

  if (groupByEvent) {
    const name = String(ev.event || 'event');
    g.byEvent[name] = (g.byEvent[name] || 0) + 1;
  }

  dayMap.set(day, g);
}
function toNumber(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}
