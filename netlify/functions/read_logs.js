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

function typeFromKey(key) {
  const f = (key.split('/').pop() || '').replace(/\.json$/i, '');
  const parts = f.split('-');
  // Nieuw formaat: <ts>-<type>-<rand> (3 delen). Ouder formaat (vóór deze fix)
  // had geen type in de key: <ts>-<rand> (2 delen) -> niet filterbaar op type.
  return parts.length >= 3 ? parts[1] : null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);

  const typesParam = (url.searchParams.get('types') || '').trim();
  const typeFilter = typesParam
    ? new Set(typesParam.split(',').map(s => s.trim()).filter(Boolean))
    : null;

  // Bij type-filtering kunnen we keys mét type-in-naam (na deze fix geschreven)
  // goedkoop uitsluiten zonder download. Oudere keys (vóór deze fix, zonder
  // type in de naam) moeten we nog steeds downloaden om hun werkelijke type
  // te kennen — vandaar een hogere limiet dan bij een ongefilterde query.
  const maxLimit = typeFilter ? 3000 : 400;
  const limit = Math.min(maxLimit, Math.max(10, parseInt(url.searchParams.get('limit') ?? '300', 10)));
  // Bovengrens op het aantal blobs dat we ECHT downloaden (legacy keys zonder
  // type-in-naam, of matches). Keys mét type-in-naam die niet matchen kosten
  // geen download. `netlify dev` voegt lokaal een diagnostische
  // x-nf-fetch-timing-header toe (één regel per download) die de lokale proxy
  // laat omvallen voorbij ~300-600 downloads — dat bestaat niet in productie
  // (echte Netlify Functions hebben een gewone 10-26s timeout, geen header-
  // instrumentatie), dus daar mag dit veel hoger.
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  const scanCap = typeFilter ? Math.min(limit, isLocalDev ? 300 : 2500) : limit;

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

  // Stap 2: sorteer nieuwste eerst
  allKeys.sort((a, b) => tsFromKey(b) - tsFromKey(a));

  // Stap 3: records ophalen in batches, met vroegtijdig afbreken zodra we
  // genoeg matches hebben. Keys mét type-in-naam die niet matchen worden
  // overgeslagen zónder download (goedkoop). Keys zonder type-in-naam
  // (oudere data) worden gedownload en daarna op hun echte `type` gefilterd.
  // Zolang vrijwel alle bestaande blobs nog "legacy" (ongetypeerd) zijn, kan
  // dat heel veel downloads betekenen — daarom ook een hard tijdsbudget,
  // zodat we altijd netjes teruggeven wat we al vonden i.p.v. te timeouten.
  const BATCH = 40;
  const SCAN_TIME_BUDGET_MS = isLocalDev ? 1500 : 8000;
  const startedAt = Date.now();
  const items = [];
  let scanned = 0;

  for (let i = 0; i < allKeys.length && items.length < limit && scanned < scanCap; i += BATCH) {
    if (Date.now() - startedAt > SCAN_TIME_BUDGET_MS) break;
    const batch = allKeys.slice(i, i + BATCH).filter(k => {
      if (!typeFilter) return true;
      const t = typeFromKey(k);
      return t ? typeFilter.has(t) : true; // onbekend type -> wel downloaden om te checken
    });
    if (!batch.length) continue;
    scanned += batch.length;

    const results = await Promise.all(
      batch.map(async (key) => {
        try {
          const val = await store.get(key);
          return val ? JSON.parse(val) : null;
        } catch { return null; }
      })
    );

    for (const it of results) {
      if (!it) continue;
      if (typeFilter && !typeFilter.has(it.type)) continue;
      items.push(it);
    }
  }

  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return respond({ items: items.slice(0, limit), total: allKeys.length });
};
