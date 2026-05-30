// netlify/functions/read_logs.js
// @netlify/blobs wordt door esbuild meegebundeld (niet external).
// In productie injecteert Netlify automatisch NETLIFY_BLOBS_CONTEXT.

import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function respond(obj) {
  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

function tsFromKey(key) {
  const f = key.split('/').pop() || '';
  const n = parseInt(f.split('-')[0], 10);
  return isNaN(n) ? 0 : n;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const params = event.queryStringParameters || {};
  const limit  = Math.min(2000, Math.max(10, parseInt(params.limit ?? '500', 10)));

  // Debug: controleer welke context beschikbaar is
  if (params.debug === '1') {
    return respond({
      hasCtx:    !!process.env.NETLIFY_BLOBS_CONTEXT,
      ctxLen:    (process.env.NETLIFY_BLOBS_CONTEXT || '').length,
      hasSiteId: !!process.env.NETLIFY_SITE_ID,
      hasTok:    !!process.env.NETLIFY_TOKEN
    });
  }

  let store;
  try {
    store = getStore('formlog');
  } catch (err) {
    return respond({ items: [], error: 'getStore failed', detail: String(err) });
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
    return respond({ items: [], error: 'list failed', detail: String(err), keysFound: allKeys.length });
  }

  if (!allKeys.length) return respond({ items: [], total: 0 });

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
  return respond({ items, total: allKeys.length });
}
