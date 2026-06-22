// netlify/functions/migrate_formlog_types.js — EENMALIG migratiescript.
// Herschrijft bestaande "formlog"-blobs zonder type-in-de-keynaam naar het
// nieuwe formaat (<ts>-<type>-<rand>.json), zodat read_logs.js ze goedkoop
// kan filteren zonder download. Na gebruik weer verwijderen uit de repo.

import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};

function typeFromKey(key) {
  const f = (key.split('/').pop() || '').replace(/\.json$/i, '');
  const parts = f.split('-');
  return parts.length >= 3 ? parts[1] : null;
}

export default async (req) => {
  const url = new URL(req.url);
  // Aantal te migreren keys per aanroep — ruim binnen de 10s functietimeout.
  // Roep deze functie gewoon herhaaldelijk aan tot "remaining": 0.
  const perCallLimit = Math.min(2000, Math.max(50, parseInt(url.searchParams.get('limit') ?? '400', 10)));

  const store = getStore('formlog');

  const allKeys = [];
  let cursor;
  while (true) {
    const page = await store.list(cursor ? { cursor } : {});
    for (const b of page?.blobs || []) { if (b?.key) allKeys.push(b.key); }
    cursor = page?.cursor ?? null;
    if (!cursor) break;
  }

  let migrated = 0, errors = 0;
  const allTodo = allKeys.filter(k => !typeFromKey(k));
  const skipped = allKeys.length - allTodo.length;
  const todo = allTodo.slice(0, perCallLimit);
  const remaining = allTodo.length - todo.length;

  const BATCH = 30;
  for (let i = 0; i < todo.length; i += BATCH) {
    const results = await Promise.all(todo.slice(i, i + BATCH).map(async (key) => {
      try {
        const val = await store.get(key);
        if (!val) return 'error';
        const data = JSON.parse(val);
        const type = String(data.type ?? 'event').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || 'event';

        // key-formaat: <code>/<dag>/<ts>-<rand>.json -> <code>/<dag>/<ts>-<type>-<rand>.json
        const parts = key.split('/');
        const fname = parts.pop().replace(/\.json$/i, '');
        const [ts, rand] = fname.split('-');
        const newKey = [...parts, `${ts}-${type}-${rand}.json`].join('/');

        await Promise.all([
          store.set(newKey, val, { contentType: 'application/json' }),
          store.delete(key)
        ]);
        return 'migrated';
      } catch {
        return 'error';
      }
    }));
    for (const r of results) {
      if (r === 'migrated') migrated++;
      else errors++;
    }
  }

  return new Response(JSON.stringify({ total: allKeys.length, migrated, skipped, errors, remaining }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
};
