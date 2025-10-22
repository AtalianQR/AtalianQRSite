// /netlify/functions/translate.js
export async function handler(event) {
  try {
    // Health-check (GET) — super handig
    if (event.httpMethod === 'GET') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          node: process.version,
          hasKey: !!process.env.OPENAI_API_KEY
        })
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const { text, source, target } = body || {};
    if (!text || !target) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing text or target' }) };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing OPENAI_API_KEY' }) };
    }

    // --- OpenAI call ---
    const sys = "Je bent een vertaalmachine. Antwoord ALTIJD als JSON {\"detected\":\"..\",\"translated\":\"..\"}.";
    const usr = `Doeltaal: ${target}\nBrontaal: ${(!source || source==='auto')?'auto-detect':source}\n--BEGIN--\n${text}\n--END--`;

    // let op: Node 18+ heeft global fetch
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        response_format: { type: "json_object" }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(()=>String(resp.status));
      console.error("OpenAI error", resp.status, errText);
      return { statusCode: resp.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed = {};
    try { parsed = JSON.parse(content); }
    catch { parsed = {}; }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: parsed.translated ?? text,
        detected: parsed.detected ?? null
      })
    };

  } catch (e) {
    console.error("Translate fn crash", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(e?.message || e) })
    };
  }
}
