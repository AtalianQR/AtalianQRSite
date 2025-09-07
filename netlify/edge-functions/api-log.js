// netlify/edge-functions/api-log.js
export default async (request, context) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  // 1) Probeer echte Blobs-store (Edge)
  let store = context?.blobs?.getStore?.('atalian-logs');

  // 2) DEV fallback: eenvoudige in-memory store wanneer Blobs niet beschikbaar is
  if (!store) {
    if (!globalThis.__ATALIAN_MEM_STORE) {
      const mem = new Map();               // key -> string
      const json = new Map();              // key -> object
      const meta = new Map();              // key -> metadata
      globalThis.__ATALIAN_MEM_STORE = {
        async set(k, v, opt={}) { mem.set(k, String(v)); meta.set(k, opt.metadata||{}); },
        async get(k, opt={}) { return opt.type === 'json' ? json.get(k) : mem.get(k); },
        async setJSON(k, obj) { json.set(k, obj); },
        async list({ prefix = '', cursor = null, limit = 200 } = {}) {
          const keys = [...json.keys()].filter(k => k.startsWith(prefix)).sort();
          const start = cursor ? Number(cursor) : 0;
          const slice = keys.slice(start, start + limit);
          const blobs = slice.map(k => ({ key: k, size: 0, last_modified: new Date().toISOString(), etag: '' }));
          const next = start + limit < keys.length ? String(start + limit) : undefined;
          return { blobs, cursor: next };
        }
      };
    }
    store = globalThis.__ATALIAN_MEM_STORE;
  }

  try {
    if (request.method === 'GET')  return handleGet(request, store);
    if (request.method === 'POST') return handlePost(request, context, store);
    return new Response('Method Not Allowed', { status: 405, headers: cors() });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
};

export const config = { path: '/api/log' };

// ---------- helpers ----------
function cors() {
  return {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: cors() }); }
async function parseBody(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) return await request.json();
  const txt = await request.text(); try { return JSON.parse(txt); } catch { return {}; }
}
function keyFor(ts) {
  const d = new Date(ts); const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `events/${yyyy}/${mm}/${dd}/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}
function clampInt(v, min, max, def) { const n = parseInt(v ?? def, 10); return Number.isNaN(n) ? def : Math.min(max, Math.max(min, n)); }

// ---------- POST ----------
async function handlePost(request, context, store) {
  const body = await parseBody(request);
  const now  = Date.now();
  const ua   = request.headers.get('user-agent') || '';
  const ip   = context?.ip || '0.0.0.0';

  const safe = {
    event: String(body.event || 'event').slice(0,64),
    visitor_id: (body.visitor_id ? String(body.visitor_id) : '').slice(0,64),
    user_id: body.user_id ? String(body.user_id).slice(0,128) : null,
    contextLabel: body.contextLabel != null ? String(body.contextLabel).slice(0,160) : null,
    urgent: (body.urgent === 'ja' || body.urgent === 'nee') ? body.urgent : null,
    photo: !!body.photo,
    desc_len: Number.isFinite(body.desc_len) ? Math.max(0, Math.min(5000, body.desc_len)) : null,
    email_present: !!body.email_present,
    lang: String(body.lang || 'nl').slice(0,5),
    ts: Number.isFinite(body.ts) ? body.ts : now,
    server_ts: now,
    ip, user_agent: ua,
	session_id: body.session_id ? String(body.session_id).slice(0,64) : null,      // ➜ NIEUW
	display_name: body.display_name != null ? String(body.display_name).slice(0,80) : null,  // ➜ NIEUW
	step: Number.isFinite(Number(body.step)) ? Number(body.step) : null           // ➜ NIEUW
	
  };

  // Simpele rate-limit per 5 min/visitor (werkt ook in dev-fallback)
  if (safe.visitor_id) {
    const bucketKey = `rate/${safe.visitor_id}/${Math.floor(now/300000)}`;
    const prev = await store.get(bucketKey, { type: 'text' });
    const cnt  = prev ? (parseInt(prev,10)||0) : 0;
    if (cnt > 30) return json({ ok:false, error:'rate_limited' }, 429);
    await store.set(bucketKey, String(cnt+1), { metadata:{ kind:'rate' } });
  }

  const key = keyFor(now);
  await (store.setJSON ? store.setJSON(key, safe) : store.set(key, JSON.stringify(safe)));
  return json({ ok:true, key }, 201);
}

// ---------- GET ----------
async function handleGet(request, store) {
  const u = new URL(request.url);
  const limit  = clampInt(u.searchParams.get('limit'), 50, 2000, 500);
  const prefix = u.searchParams.get('prefix') || 'events/';

  let items = [], cursor = undefined;
  do {
    const page = await store.list({ prefix, cursor, limit: Math.min(200, limit - items.length) });
    for (const b of page?.blobs || []) {
      if (items.length >= limit) break;
      const rec = await store.get(b.key, { type: 'json' }).catch(() => null);
      if (rec) items.push(rec);
    }
    cursor = page?.cursor;
  } while (cursor && items.length < limit);

  items.sort((a,b)=> (b.server_ts||b.ts||0) - (a.server_ts||a.ts||0));
  return json({ items, totals:{ total: items.length } });
}
