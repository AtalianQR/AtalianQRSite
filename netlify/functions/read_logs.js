// netlify/functions/read_logs.js — Netlify Functions v2
import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function respond(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

function tsFromKey(key) {
  const f = key.split('/').pop() || '';
  const n = parseInt(f.split('-')[0], 10);
  return isNaN(n) ? 0 : n;
}

// Haal alle keys op voor één dag-prefix
async function listDayKeys(store, prefix) {
  const keys = [];
  try {
    let cursor;
    while (true) {
      const page = await store.list(cursor ? { cursor, prefix } : { prefix });
      const blobs = Array.isArray(page?.blobs) ? page.blobs : [];
      for (const b of blobs) { if (b?.key) keys.push(b.key); }
      cursor = page?.cursor ?? null;
      if (!cursor) break;
    }
  } catch {}
  return keys;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url   = new URL(req.url);
  const limit = Math.min(1000, Math.max(10, parseInt(url.searchParams.get('limit') ?? '500', 10)));

  if (url.searchParams.get('debug') === '1') {
    return respond({ hasCtx: !!process.env.NETLIFY_BLOBS_CONTEXT, ctxLen: (process.env.NETLIFY_BLOBS_CONTEXT || '').length });
  }

  let store;
  try {
    store = getStore('formlog');
  } catch (err) {
    return respond({ items: [], error: 'getStore failed', detail: String(err) });
  }

  // Stap 1: genereer dag-prefixes voor afgelopen 90 dagen en vraag ze parallel op
  const dayPrefixes = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.now() - i * 86400000);
    dayPrefixes.push(`unknown/${d.toISOString().slice(0, 10)}/`);
  }

  // Lijst in batches van 10 dagen parallel
  const allKeys = [];
  const DAY_BATCH = 10;
  for (let i = 0; i < dayPrefixes.length; i += DAY_BATCH) {
    const batch = dayPrefixes.slice(i, i + DAY_BATCH);
    const results = await Promise.all(batch.map(prefix => listDayKeys(store, prefix)));
    for (const keys of results) allKeys.push(...keys);
    if (allKeys.length >= limit * 3) break;
  }

  if (!allKeys.length) return respond({ items: [], total: 0 });

  // Stap 2: sorteer nieuwste eerst en beperk
  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
  const topKeys = allKeys.slice(0, limit);

  // Stap 3: records ophalen in batches van 40 parallel
  const BATCH = 40;
  const items = [];
  for (let i = 0; i < topKeys.length; i += BATCH) {
    const results = await Promise.all(
      topKeys.slice(i, i + BATCH).map(async (key) => {
        try {
          const val = await store.get(key);
          return val ? JSON.parse(val) : null;
        } catch { return null; }
      })
    );
    items.push(...results.filter(Boolean));
  }

  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return respond({ items, total: allKeys.length });
};
