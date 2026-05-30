// netlify/functions/read_logs.js — Netlify Functions v2
// NETLIFY_BLOBS_CONTEXT wordt automatisch geïnjecteerd in v2 functies.

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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url   = new URL(req.url);
  // Max 200 records ophalen — elke key = 1 API-call, te veel = timeout
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') ?? '150', 10)));

  if (url.searchParams.get('debug') === '1') {
    return respond({ hasCtx: !!process.env.NETLIFY_BLOBS_CONTEXT, ctxLen: (process.env.NETLIFY_BLOBS_CONTEXT || '').length });
  }

  let store;
  try {
    store = getStore('formlog');
  } catch (err) {
    return respond({ items: [], error: 'getStore failed', detail: String(err) });
  }

  // Stap 1: keys verzamelen
  const allKeys = [];
  try {
    let cursor;
    while (true) {
      const page = await store.list(cursor ? { cursor } : {});
      const blobs = Array.isArray(page?.blobs) ? page.blobs : [];
      for (const b of blobs) { if (b?.key) allKeys.push(b.key); }
      cursor = page?.cursor ?? null;
      if (!cursor) break;
    }
  } catch (err) {
    return respond({ items: [], error: 'list failed', detail: String(err), keysFound: allKeys.length });
  }

  if (!allKeys.length) return respond({ items: [], total: 0 });

  // Stap 2: sorteer en beperk
  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
  const topKeys = allKeys.slice(0, limit);

  // Stap 3: records ophalen in batches
  const BATCH = 20;
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
