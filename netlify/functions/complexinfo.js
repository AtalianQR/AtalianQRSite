// complexinfo.js — dedicated LIST_COMPLEX handler

const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL      = process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT   = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION = "_rest_QueryAtalianJobs";

/* ---------- Helpers ---------- */
async function callUltimo(payload) {
  const res = await fetch(`${BASE_URL}/action/${ULTIMO_ACTION}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      ApiKey: API_KEY,
      ApplicationElementId: APP_ELEMENT,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, text: await res.text() };
  }
  return { ok: true, json: await res.json() };
}

function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;

  const txt = String(s).trim();
  if (txt.startsWith("{") && txt.endsWith("}")) {
    try { return JSON.parse(txt); } catch (e) {}
  }
  return txt;
}

/* ---------- Handler ---------- */
export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const { complex } = event.queryStringParameters || {};
    if (!complex || !/^[SE]\d+$/.test(complex)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Ongeldige complexSelector. Verwacht: Sxxxxxx of Exxxxxx" }),
      };
    }

    // Call workflow
    const r = await callUltimo({
      Action: "LIST_COMPLEX",
      ComplexSelector: complex,
    });

    if (!r.ok) {
      return { statusCode: r.status, body: r.text };
    }

    const out = getOutputObject(r.json);
    if (!out || !out.Items) {
      return {
        statusCode: 200,
        body: JSON.stringify({ Items: [] }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(out),
    };
  } catch (err) {
    console.error("complexinfo error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
