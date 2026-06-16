// netlify/functions/read_logs.js — Netlify Functions v2
import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function respond(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
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
  const limit = Math.min(1000, Math.max(10, parseInt(url.searchParams.get('limit') ?? '500', 10)));
  const debug = url.searchParams.get('debug');

  let store;
  try {
    store = getStore('formlog');
  } catch (err) {
    return respond({ items: [], error: 'getStore failed', detail: String(err) });
  }

  // Debug mode: toon eerste pagina en key-formaat zonder alles op te halen
  if (debug === '1') {
    try {
      const page = await store.list({});
      const blobs = page?.blobs ?? [];
      return respond({
        hasCtx: !!process.env.NETLIFY_BLOBS_CONTEXT,
        totalOnFirstPage: blobs.length,
        hasCursor: !!page?.cursor,
        sampleKeys: blobs.slice(0, 5).map(b => b?.key),
      });
    } catch (err) {
      return respond({ error: 'list failed', detail: String(err) });
    }
  }

  // Stap 1: keys ophalen via dag-prefixes (sequentieel, meest recent eerst)
  const allKeys = [];
  const MAX_DAYS = 90;
  try {
    for (let i = 0; i < MAX_DAYS && allKeys.length < limit * 2; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const prefix = `unknown/${d.toISOString().slice(0, 10)}/`;
      let cursor;
      while (true) {
        const page = await store.list(cursor ? { cursor, prefix } : { prefix });
        const blobs = Array.isArray(page?.blobs) ? page.blobs : [];
        for (const b of blobs) { if (b?.key) allKeys.push(b.key); }
        cursor = page?.cursor ?? null;
        if (!cursor) break;
      }
    }
  } catch (err) {
    // Fallback: geef terug wat we tot nu toe hebben
    if (!allKeys.length) return respond({ items: [], error: 'list failed', detail: String(err) });
  }

  if (!allKeys.length) return respond({ items: [], total: 0 });

  // Stap 2: sorteer nieuwste eerst en beperk
  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));
  const topKeys = allKeys.slice(0, limit);

  // Stap 3: records ophalen in batches van 30 parallel
  const BATCH = 30;
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
