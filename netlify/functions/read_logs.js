// netlify/functions/read_logs.js
// Leest log-events uit de Netlify Blobs 'formlog' store.
// Keys: ${code}/${day}/${ts}-${rand}.json (geschreven door formlog.js)

import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function json(status, obj) {
  return { statusCode: status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

// Haal de Unix-ms timestamp uit de blob-key: code/day/ts-rand.json
function tsFromKey(key) {
  const file = key.split('/').pop() || '';
  const ts = parseInt(file.split('-')[0], 10);
  return isNaN(ts) ? 0 : ts;
}

export async function handler(event) {
  const method = event.httpMethod?.toUpperCase() || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (method !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const params = event.queryStringParameters || {};
  const limit = Math.min(2000, Math.max(10, parseInt(params.limit ?? '500', 10)));

  try {
    const store = getStore('formlog');

    // Stap 1: verzamel alle keys (gepagineerd)
    const allKeys = [];
    let cursor;
    do {
      const page = await store.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const blob of page.blobs) allKeys.push(blob.key);
      cursor = page.cursor;
    } while (cursor);

    if (!allKeys.length) return json(200, { items: [], total: 0 });

    // Stap 2: sorteer op timestamp aflopend, neem de top N
    allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
    const topKeys = allKeys.slice(0, limit);

    // Stap 3: haal blobs op in batches van 50
    const BATCH = 50;
    const items = [];
    for (let i = 0; i < topKeys.length; i += BATCH) {
      const batch = topKeys.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (key) => {
          try {
            const val = await store.get(key);
            if (!val) return null;
            return JSON.parse(val);
          } catch {
            return null;
          }
        })
      );
      items.push(...results.filter(Boolean));
    }

    // Stap 4: sorteer op ts aflopend (meest recent eerst)
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    return json(200, { items, total: allKeys.length });

  } catch (err) {
    console.error('[read_logs] ERROR', err?.stack || err?.message || err);
    return json(200, { items: [], error: String(err) });
  }
}
