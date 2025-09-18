// src/index.js — volledige versie met globale CORS + bugfix
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);

    // 1) Preflight overal
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // 2) Logs-API
    if (url.pathname === '/api/log') {
      if (request.method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch {}

        const now = Date.now();
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
          lang: String(body.lang || 'nl').slice(0, 5),
          step: Number.isFinite(+body.step) ? +body.step : null,
          ts: Number.isFinite(+body.ts) ? +body.ts : now,
          server_ts: now,
        };

        const key = `events/${new Date(now).toISOString().slice(0, 10)}/${now}-${Math.random().toString(36).slice(2)}.json`;
        await env.atalian_logs.put(key, JSON.stringify(safe));

        return json({ ok: true, key }, 200, origin);
      }

      if (request.method === 'GET') {
        const limit = Math.min(50000, Math.max(1, parseInt(url.searchParams.get('limit') || '5000', 10)));
        const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;

        let keys = [];
        let cursor;

        while (keys.length < limit) {
          const page = await env.atalian_logs.list({ prefix: 'events/', cursor, limit: 200 });
          // BUGFIX: geen leading dot
          keys.push(...page.keys.map(k => k.name));
          if (page.list_complete) break;
          cursor = page.cursor;
        }

        keys.sort().reverse();
        keys = keys.slice(0, limit);

        const items = [];
        for (const name of keys) {
          const val = await env.atalian_logs.get(name, { type: 'json' });
          if (val && (!since || (val.server_ts || val.ts || 0) >= since)) items.push(val);
        }

        return json({ items }, 200, origin);
      }

      return new Response('Method Not Allowed', { status: 405, headers });
    }

    // 3) Health endpoint
    if (url.pathname === '/health') {
      return json({ ok: true, time: Date.now() }, 200, origin);
    }

    // 4) 404 mét CORS
    return new Response('Not Found', { status: 404, headers });
  }
};

// Whitelist + echo van Origin
function cors(origin) {
  const allow = [
    'https://atalianqrportal.netlify.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];
  const allowedOrigin = allow.includes(origin) ? origin : 'https://atalianqrportal.netlify.app';
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
