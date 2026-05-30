// netlify/functions/read_logs.js
// Leest log-events uit de Netlify Blobs 'formlog' store.
// Keys: ${code}/${day}/${ts}-${rand}.json  (geschreven door formlog.js)

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
  const file = key.split('/').pop() || '';
  const ts = parseInt(file.split('-')[0], 10);
  return isNaN(ts) ? 0 : ts;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  const params = event.queryStringParameters || {};
  const limit = Math.min(2000, Math.max(10, parseInt(params.limit ?? '500', 10)));

  let store;
  try {
    store = getStore('formlog');
  } catch (err) {
    return respond({ items: [], error: 'getStore failed', detail: String(err) });
  }

  // Stap 1: verzamel alle keys (gepagineerd)
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

  // Stap 2: sorteer op timestamp aflopend, neem de top N
  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
  const topKeys = allKeys.slice(0, limit);

  // Stap 3: haal blobs op in batches van 50
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
