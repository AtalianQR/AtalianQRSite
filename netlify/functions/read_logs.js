// netlify/functions/read_logs.js
// Leest log-events rechtstreeks via de Netlify Blobs REST API.

const SITE_ID   = process.env.NETLIFY_SITE_ID || '4233a8d5-6bcf-4c11-bea4-9ceb922e17cf';
const TOKEN     = process.env.NETLIFY_TOKEN;
const STORE     = 'formlog';
const API_BASE  = `https://api.netlify.com/api/v1/sites/${SITE_ID}/blobs/${STORE}`;

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

async function blobsGet(path = '', params = {}) {
  const url = new URL(API_BASE + (path ? '/' + path : ''));
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Netlify Blobs API ${res.status}: ${await res.text()}`);
  return res;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  if (!TOKEN) return respond({ items: [], error: 'NETLIFY_TOKEN not set' });

  const params = event.queryStringParameters || {};
  const limit = Math.min(2000, Math.max(10, parseInt(params.limit ?? '500', 10)));

  // Stap 1: verzamel alle keys via list-endpoint
  const allKeys = [];
  try {
    let cursor;
    while (true) {
      const qp = { list: 'true' };
      if (cursor) qp.cursor = cursor;
      const res = await blobsGet('', qp);
      const data = await res.json();
      for (const b of (data?.blobs ?? [])) allKeys.push(b.key);
      cursor = data?.cursor;
      if (!cursor) break;
    }
  } catch (err) {
    return respond({ items: [], error: 'list failed', detail: String(err), keysFound: allKeys.length });
  }

  if (!allKeys.length) return respond({ items: [], total: 0 });

  // Stap 2: sorteer op timestamp, neem top N
  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
  const topKeys = allKeys.slice(0, limit);

  // Stap 3: haal records op in batches van 50
  const BATCH = 50;
  const items = [];
  for (let i = 0; i < topKeys.length; i += BATCH) {
    const results = await Promise.all(
      topKeys.slice(i, i + BATCH).map(async (key) => {
        try {
          const res = await blobsGet(encodeURIComponent(key));
          return await res.json();
        } catch { return null; }
      })
    );
    items.push(...results.filter(Boolean));
  }

  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return respond({ items, total: allKeys.length });
}
