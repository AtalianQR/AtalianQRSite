// src/index.js — Cloudflare Worker met globale CORS, preview-origins, en KV logging
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const hdrs   = cors(origin);        // CORS headers voor ALLE responses

    // 1) Preflight voor elke route
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: hdrs });
    }

    // 2) API: logs opslaan/lezing (KV = env.atalian_logs)
    if (url.pathname === '/api/log') {
      if (request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch { /* leeg is ok */ }

        const now  = Date.now();
        const safe = {
          event: String(body.event || 'event').slice(0, 64),
          visitor_id: body.visitor_id ? String(body.visitor_id).slice(0, 64) : null,
          user_id: body.user_id ? String(body.user_id).slice(0, 128) : null,
          session_id: body.session_id ? String(body.session_id).slice(0, 64) : null,
          contextLabel: body.contextLabel ?? null,
          urgent: body.urgent ?? null,
          photo: !!body.photo,
          desc_len: Number.isFinite(+body.desc_len) ? +body.desc_len : null,
          email_present: !!body.email_present,
          lang: String(body.lang || 'nl').slice(0, 8),
          step: Number.isFinite(+body.step) ? +body.step : null,
          ts: Number.isFinite(+body.ts) ? +body.ts : now,
          server_ts: now,
        };

        const day = new Date(now).toISOString().slice(0, 10);
        const key = `events/${day}/${now}-${Math.random().toString(36).slice(2)}.json`;

        await env.atalian_logs.put(key, JSON.stringify(safe));
        return json({ ok: true, key }, 200, origin);
      }

      if (request.method === 'GET') {
        // Query params
        const limit = clampInt(url.searchParams.get('limit'), 1, 50000, 5000);
        const since = toInt(url.searchParams.get('since'), 0);

        // Keys verzamelen (pagineren over KV)
        let keys = [];
        let cursor;
        while (keys.length < limit) {
          const page = await env.atalian_logs.list({ prefix: 'events/', cursor, limit: 200 });
          // BUGFIX t.o.v. jouw oude versie: géén leading dot
          keys.push(...page.keys.map(k => k.name));
          if (page.list_complete) break;
          cursor = page.cursor;
        }

        // Nieuwste eerst
        keys.sort().reverse();
        keys = keys.slice(0, limit);

        // Waarden ophalen en filteren op 'since'
        const items = [];
        for (const name of keys) {
          const val = await env.atalian_logs.get(name, { type: 'json' });
          if (!val) continue;
          const t = (val.server_ts ?? val.ts ?? 0);
          if (!since || t >= since) items.push(val);
        }

        return json({ items }, 200, origin);
      }

      return new Response('Method Not Allowed', { status: 405, headers: hdrs });
    }

    // 3) Health-check
    if (url.pathname === '/health') {
      return json({ ok: true, time: Date.now() }, 200, origin);
    }

    // 4) Favicon-stub (houdt je console proper in demos)
    if (url.pathname === '/favicon.ico') {
      // Lege ico met juiste headers (CORS blijft aanwezig via hdrs)
      return new Response('', { status: 204, headers: { ...hdrs, 'Content-Type': 'image/x-icon' } });
    }

    // 5) Default 404 mét CORS
    return new Response('Not Found', { status: 404, headers: hdrs });
  }
};

// -------- Helpers --------

// Dynamische CORS met preview-support (.netlify.app)
function cors(origin) {
  const o = origin || '';
  let host = '';
  try { host = new URL(o).host } catch { host = '' }

  const allow = [
    'atalianqrportal.netlify.app',
    'localhost:5173',
    '127.0.0.1:5173'
  ];
  const allowPreview = host.endsWith('.netlify.app'); // laat Netlify previews toe
  const allowedOrigin = (allow.includes(host) || allowPreview) ? o : 'https://atalianqrportal.netlify.app';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function json(obj, status = 200, origin = '') {
  return new Response(JSON.stringify(obj), { status, headers: cors(origin) });
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
