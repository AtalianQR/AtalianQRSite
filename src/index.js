export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/log") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

      if (request.method === "POST") {
        let body = {};
        try { body = await request.json(); } catch {}
        const now = Date.now();
        const safe = {
          event: String(body.event || "event").slice(0,64),
          visitor_id: body.visitor_id ? String(body.visitor_id).slice(0,64) : null,
          user_id: body.user_id ? String(body.user_id).slice(0,128) : null,
          session_id: body.session_id ? String(body.session_id).slice(0,64) : null,
          contextLabel: body.contextLabel ?? null,
          urgent: body.urgent ?? null,
          photo: !!body.photo,
          desc_len: Number.isFinite(+body.desc_len) ? +body.desc_len : null,
          email_present: !!body.email_present,
          lang: String(body.lang || "nl").slice(0,5),
          step: Number.isFinite(+body.step) ? +body.step : null,
          ts: Number.isFinite(+body.ts) ? +body.ts : now,
          server_ts: now
        };
        // per-dag keyspace
        const key = `events/${new Date(now).toISOString().slice(0,10)}/${now}-${Math.random().toString(36).slice(2)}.json`;
        await env.LOGS.put(key, JSON.stringify(safe));
        return json({ ok:true, key });
      }

      if (request.method === "GET") {
        const limit = Math.min(50000, Math.max(1, parseInt(url.searchParams.get("limit")||"5000",10)));
        const since = parseInt(url.searchParams.get("since")||"0",10) || 0; // optioneel: filter client-side

        // keys ophalen in “pages”
        let keys=[], cursor;
        while (keys.length < limit) {
          const page = await env.LOGS.list({ prefix: "events/", cursor, limit: Math.min(1000, limit - keys.length) });
          keys.push(...page.keys.map(k=>k.name));
          if (!page.list_complete) cursor = page.cursor; else break;
        }

        // nieuwste eerst
        keys.sort().reverse();
        keys = keys.slice(0, limit);

        const items = [];
        for (const name of keys) {
          const val = await env.LOGS.get(name, { type:"json" });
          if (val && (!since || (val.server_ts||val.ts||0) >= since)) items.push(val);
        }
        return json({ items });
      }

      return new Response("Method Not Allowed", { status: 405, headers: cors() });
    }

    if (url.pathname === "/health") return json({ ok:true, time: Date.now() });
    return new Response("Not Found", { status: 404 });
  }
};

function cors(){
  return {
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type",
    "content-type":"application/json",
    "cache-control":"no-store"
  };
}
function json(obj, status=200){ return new Response(JSON.stringify(obj), { status, headers: cors() }); }
