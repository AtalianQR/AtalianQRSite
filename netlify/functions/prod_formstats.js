// netlify/functions/prod_formstats.js
import { getStore } from '@netlify/blobs';

/**
 * Prod form stats – snelle, robuuste aggregator.
 * - Parallel lezen met limiet (concurrency pool)
 * - Per-request timeouts (AbortController)
 * - Skip losse JSON events als er NDJSON voor die dag is
 * - Debug timings met ?debug=1
 *
 * Query params:
 *   from=YYYY-MM-DD   (inclusief)
 *   to=YYYY-MM-DD     (inclusief)
 *   view=keys         (optioneel: lijst keys i.p.v. lezen)
 *   debug=1           (timings en counters)
 */
export default async (req) => {
  const tStart = Date.now();
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // CORS & method guard
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (method !== 'GET') return new Response(JSON.stringify({ ok: false, msg: 'Method Not Allowed' }), { status: 405, headers });

  const from = (url.searchParams.get('from') || '').slice(0, 10);
  const to   = (url.searchParams.get('to')   || '').slice(0, 10);
  const view = (url.searchParams.get('view') || '').trim();
  const debug = url.searchParams.get('debug') === '1';

  // Validatie datums (light)
  const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isIso(from) || !isIso(to) || from > to) {
    return new Response(JSON.stringify({ ok:false, msg:'Invalid date range', from, to }), { status: 400, headers });
  }

  // Blobs-store
  const store = getStore(); // gebruikt je site-wide blobs store

  // 1) Alle keys ophalen binnen bereik (prefixen daily/ en events/)
  const tKeys0 = Date.now();
  const [ndjsonKeys, jsonEventKeys] = await listKeysForRange(store, from, to);
  const tKeys1 = Date.now();

  if (view === 'keys') {
    return json({
      ok: true,
      from, to,
      counts: { daily: ndjsonKeys.length, events: jsonEventKeys.length },
      sample: {
        daily: ndjsonKeys.slice(0, 5),
        events: jsonEventKeys.slice(0, 5)
      },
      timings: debug ? { t_keys_ms: tKeys1 - tKeys0, t_total_ms: Date.now() - tStart } : undefined
    }, headers);
  }

  // 2) Aggregatie – lees NDJSON (dagfiles) en vul aan met losse events
  const tRead0 = Date.now();

  // A) map met dagen die al NDJSON hebben
  const ndjsonDays = new Set(ndjsonKeys.map(k => {
    const m = k.match(/daily\/(\d{4}-\d{2}-\d{2})\.ndjson$/);
    return m ? m[1] : null;
  }).filter(Boolean));

  // B) filter JSON events van dagen die al NDJSON hebben
  const jsonEventKeysFiltered = jsonEventKeys.filter(k => {
    const m = k.match(/events\/(\d{4}-\d{2}-\d{2})\//);
    const day = m ? m[1] : null;
    return day ? !ndjsonDays.has(day) : true;
  });

  // C) Aggregatiemap
  const dayMap = new Map();
  const handleEvent = (ev) => aggregateEvent(dayMap, ev, from, to);

  // D) Helpers: timeouts + pool
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
        try { await worker(item); } catch { /* swallow, we blijven doorwerken */ }
      }
    });
    await Promise.all(workers);
  };

  // E) Lees NDJSON – parallel
  let readDaily = 0, readEvents = 0;
  await runPool(ndjsonKeys, 8, async (key) => {
    const text = await withTimeout(store.get(key, { type: 'text' }), 8000);
    if (!text) return;
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { handleEvent(JSON.parse(s)); readDaily++; } catch {}
    }
  });

  // F) Lees losse JSON events – parallel
  await runPool(jsonEventKeysFiltered, 8, async (key) => {
    const s = await withTimeout(store.get(key, { type: 'text' }), 6000);
    if (!s) return;
    try { handleEvent(JSON.parse(s)); readEvents++; } catch {}
  });

  const tRead1 = Date.now();

  // 3) Output bouwen
  const days = [...dayMap.keys()].sort();
  const items = days.map(d => ({ day: d, ...dayMap.get(d) }));

  const payload = {
    ok: true,
    from, to,
    items
  };
  if (debug) {
    payload.debug = {
      counts: {
        keys_daily: ndjsonKeys.length,
        keys_events: jsonEventKeys.length,
        read_daily_lines: readDaily,
        read_event_files: readEvents
      },
      timings_ms: {
        list_keys: tKeys1 - tKeys0,
        read_aggregate: tRead1 - tRead0,
        total: Date.now() - tStart
      }
    };
  }

  return new Response(JSON.stringify(payload), { status: 200, headers });
};

/* ------------------ helpers ------------------ */

// Geef alle keys terug voor [from..to] binnen de twee prefixen
const PREFIX_DAILY  = 'daily/';   // bv. daily/2025-09-18.ndjson
const PREFIX_EVENTS = 'events/';  // bv. events/2025-09-18/123.json

async function listKeysForRange(store, from, to) {
  // We pagineren per prefix, en filteren op datum in de key-string
  const ndjsonKeys = await listAll(store, PREFIX_DAILY, k => {
    const m = k.match(/^daily\/(\d{4}-\d{2}-\d{2})\.ndjson$/);
    return m ? (m[1] >= from && m[1] <= to) : false;
  });

  const jsonEventKeys = await listAll(store, PREFIX_EVENTS, k => {
    const m = k.match(/^events\/(\d{4}-\d{2}-\d{2})\//);
    return m ? (m[1] >= from && m[1] <= to) : false;
  });

  // Sorteer nieuwste eerst (optioneel)
  ndjsonKeys.sort().reverse();
  jsonEventKeys.sort().reverse();

  return [ndjsonKeys, jsonEventKeys];
}

async function listAll(store, prefix, predicate) {
  const out = [];
  let cursor = undefined;
  do {
    const page = await store.list({ prefix, limit: 500, cursor });
    for (const { key } of page.blobs ?? []) {
      if (!predicate || predicate(key)) out.push(key);
    }
    cursor = page.cursor;
    if (page.complete) break;
  } while (cursor);
  return out;
}

// Voeg event toe aan dag-aggregaat
function aggregateEvent(dayMap, ev, from, to) {
  // Event kan uit verschillende schema’s komen; we normaliseren minimaal
  const ts = toInt(ev.server_ts ?? ev.ts ?? Date.now());
  const day = (new Date(ts)).toISOString().slice(0, 10);
  if (day < from || day > to) return;

  const grp = dayMap.get(day) || {
    total: 0,
    byEvent: {},      // eventnaam → count
    withPhoto: 0,
    urgent: 0
  };

  grp.total += 1;
  const name = String(ev.event || 'event');
  grp.byEvent[name] = (grp.byEvent[name] || 0) + 1;
  if (ev.photo) grp.withPhoto += 1;
  if (ev.urgent) grp.urgent += 1;

  dayMap.set(day, grp);
}

function toInt(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function json(obj, headers, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers });
}
