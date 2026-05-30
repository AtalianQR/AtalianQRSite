// netlify/functions/read_logs.js  — Netlify Functions v2
import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function json(obj) {
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

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url    = new URL(req.url);
  const limit  = Math.min(2000, Math.max(10, parseInt(url.searchParams.get('limit') ?? '500', 10)));

  if (url.searchParams.get('debug') === '1') {
    return json({ hasCtx: !!process.env.NETLIFY_BLOBS_CONTEXT, ctxLen: (process.env.NETLIFY_BLOBS_CONTEXT || '').length, hasContext: !!context });
  }

  let store;
  try {
    // context meegeven: Netlify v2 injecteert de Blobs-credentials via context
    store = getStore({ name: 'formlog', context });
  } catch (err) {
    return json({ items: [], error: 'getStore failed', detail: String(err) });
  }

  const allKeys = [];
  try {
    let cursor;
    while (true) {
      const page = await store.list(cursor ? { cursor } : {});
      for (const b of (page?.blobs ?? [])) allKeys.push(b.key);
      cursor = page?.cursor;
      if (!cursor) break;
    }
  } catch (err) {
    return json({ items: [], error: 'list failed', detail: String(err), keysFound: allKeys.length });
  }

  if (!allKeys.length) return json({ items: [], total: 0 });

  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
  const topKeys = allKeys.slice(0, limit);

  const BATCH = 50;
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
  return json({ items, total: allKeys.length });
};
