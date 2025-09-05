// Centrale opslag met Netlify Blobs via Edge Functions.
// Endpoints:
//  - POST /api/log  (body: JSON van je ticket)
//  - GET  /api/log  (retour: { items:[...], totals:{...} })

export default async (request, context) => {
  const store = context.blobs; // Netlify voorziet dit in Edge Functions
  const url = new URL(request.url);
  const method = request.method;

  // CORS (voor veiligheid kun je origin whitelisten)
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (method === "OPTIONS") return new Response("", { headers: cors });

  if (method === "POST") {
    try {
      const data = await request.json();
      const id = crypto.randomUUID();
      const record = {
        id,
        ts: Date.now(),
        contextLabel: data.contextLabel || "",
        urgent: data.urgent || "nee",
        desc: data.desc || "",
        email: data.email || "",
        photo: !!data.photo,
        lang: (data.lang || "nl").toLowerCase(),
        ua: request.headers.get("user-agent") || "",
      };
      await store.setJSON(`tickets/${id}.json`, record);
      return json({ ok: true, id }, 201, cors);
    } catch (e) {
      return json({ ok: false, error: String(e) }, 400, cors);
    }
  }

  if (method === "GET") {
    // lijst ophalen + aggregeren
    const list = await store.list({ prefix: "tickets/" });
    const items = [];
    for (const b of list.blobs) {
      const rec = await store.getJSON(b.key);
      if (rec) items.push(rec);
    }
    // sorteer nieuw → oud
    items.sort((a, b) => b.ts - a.ts);

    // simpele aggregaties
    const countBy = (key, map = (x)=>x) =>
      items.reduce((acc, r) => { const k = map(r[key]); acc[k] = (acc[k]||0)+1; return acc; }, {});
    const totals = {
      total: items.length,
      perScenario: countBy("contextLabel"),
      urgent: countBy("urgent", v => v === "ja" ? "dringend" : "kan wachten"),
      photo: countBy("photo", v => v ? "met foto" : "zonder foto"),
      lang: countBy("lang"),
    };

    return json({ ok: true, items, totals }, 200, cors);
  }

  return json({ ok: false, error: "Method not allowed" }, 405, cors);
};

export const config = {
  path: "/api/log",
};

// helper
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
