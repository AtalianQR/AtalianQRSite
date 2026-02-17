// netlify/functions/vendorlist.js
/* eslint-disable */

// ================================================================
// ENV (zelfde patroon als jobsvendor.js)
// ================================================================
const API_KEY        = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD  = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST  = process.env.ULTIMO_API_BASEURL_TEST;

const API_KEY_TEST   = process.env.ULTIMO_API_KEY_TEST || API_KEY;

const APP_PROD       = process.env.APP_ELEMENT_QueryAtalianJobs;
const APP_TEST       = process.env.APP_ELEMENT_QueryAtalianJobs_TEST || APP_PROD;

const ULTIMO_ACTION  = "_rest_QueryAtalianJobs"; // Ultimo action/workflow mapping

// ================================================================
// CORS helper
// ================================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,apikey,applicationelementid",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function respond(statusCode, bodyObj) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(bodyObj) };
}

// ================================================================
// Kleine helpers
// ================================================================
function safeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  return e;
}

function safeComplexId(v) {
  // Hou dit bewust mild: trim + string. (Als je wil: regex op 6 cijfers)
  return String(v || "").trim();
}

function safeVendorId(v) {
  return String(v || "").trim(); // mild, zelfde stijl als complexId
}

// Robuuste params parsing (queryStringParameters kan soms leeg zijn)
function getParams(event) {
  const qs = event.queryStringParameters || {};
  if (qs && Object.keys(qs).length > 0) return qs;

  const raw =
    event.rawQueryString ||
    event.rawQuery ||
    (event.rawUrl
      ? new URL(event.rawUrl, "http://localhost").searchParams.toString()
      : "") ||
    "";

  if (!raw) return {};
  const usp = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  return Object.fromEntries(usp.entries());
}

// ================================================================
// Env keuze (zelfde logica als jobsvendor.js, maar kleiner)
// ================================================================
function isTestRequested(event) {
  const qs = getParams(event);
  const hdr = event.headers || {};
  const h = (k) => String(hdr[k] || hdr[k?.toLowerCase()] || "").toLowerCase();

  const ref = h("referer");
  const org = h("origin");
  const xenv = h("x-atalian-env");

  if (qs.test === "1" || qs.test === "true" || (qs.env || "").toLowerCase() === "test") return true;
  if (xenv === "test") return true;
  if (/\b(test=1|env=test)\b/i.test(ref)) return true;
  if (/localhost:8888/.test(org)) return true;

  return false;
}

function normalizeBaseUrl(base) {
  // Sommige setups zetten BASE_URL al op .../api/v1, andere niet.
  // We normaliseren naar ".../api/v1" zodat "/action/..." altijd klopt.
  let b = String(base || "").replace(/\/$/, "");
  if (!b) return b;
  if (!/\/api\/v1$/i.test(b)) b = `${b}/api/v1`;
  return b;
}

function buildEnvConfig(event) {
  const isTest = isTestRequested(event);

  const prod = {
    base: normalizeBaseUrl(BASE_URL_PROD),
    key: API_KEY,
    app: APP_PROD,
    name: "PROD",
  };

  const test = {
    base: normalizeBaseUrl(BASE_URL_TEST),
    key: API_KEY_TEST,
    app: APP_TEST,
    name: "TEST",
  };

  const cfg = isTest ? test : prod;

  if (isTest && (!cfg.base || cfg.base === prod.base)) {
    throw new Error("TEST gevraagd maar ULTIMO_API_BASEURL_TEST ontbreekt of is gelijk aan PROD.");
  }
  if (!cfg.base || !cfg.key || !cfg.app) {
    throw new Error(`Serverconfig onvolledig voor ${cfg.name}: base/key/app ontbreken.`);
  }

  console.log(`[vendorlist] Env=${cfg.name} | Base=${cfg.base}`);
  return cfg;
}

// ================================================================
// Ultimo call helper (zelfde patroon als jobsvendor.js)
// ================================================================
async function callUltimo(cfg, payload) {
  const url = `${cfg.base}/action/${ULTIMO_ACTION}`;

  console.log(
    `[vendorlist] callUltimo via ${cfg.name}: ${payload?.Action || "n/a"} | url=${url}`
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      ApiKey: cfg.key,
      ApplicationElementId: cfg.app,
    },
    body: JSON.stringify(payload || {}),
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`Ultimo API fout (${res.status}): ${text}`);
  }

  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  return { ok: true, json, rawText: text, url };
}

/**
 * Output.object kan:
 * - JSON-string zijn ({ "Jobs":[...], ... })
 * - "true"/"false"
 * - Base64 string
 */
function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;

  let txt = String(s).trim();

  // cleanup (zelfde spirit als jobsvendor)
  txt = txt
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/[\u0000-\u001F]+/g, " ");

  if (txt.startsWith("{") && txt.endsWith("}")) {
    try {
      return JSON.parse(txt);
    } catch (e) {
      console.error("[vendorlist] getOutputObject parsefout:", e.message);
      console.log("[vendorlist] JSON (start):", txt.slice(0, 300));
    }
  }

  return txt;
}

// ================================================================
// Handler
// ================================================================
export async function handler(event) {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    // Sanity
    if (!API_KEY || !BASE_URL_PROD || !APP_PROD) {
      return respond(500, {
        error:
          "Serverconfig onvolledig: ontbrekende ULTIMO_API_KEY / ULTIMO_API_BASEURL / APP_ELEMENT_QueryAtalianJobs.",
      });
    }

    const cfg = buildEnvConfig(event);

    // Alleen GET voor nu (simpel & voorspelbaar)
    if (event.httpMethod !== "GET") {
      return respond(405, { error: "Methode niet toegestaan." });
    }

    const params = getParams(event);

    const action = String(params.action || "").trim().toUpperCase();
    const email = safeEmail(params.email || params.Email || params.EMAIL || "");
    const complexId = safeComplexId(params.complexId || params.ComplexId || params.COMPLEXID || "");
    const vendorId = safeVendorId(params.vendorId || params.VendorId || params.VENDORID || "");

    if (!email) {
      return respond(400, {
        error: "email ontbreekt of ongeldig",
        debug: { receivedParams: params },
      });
    }

    const allowedActions = ["LIST_ALLCOMPLEXJOBS", "LIST_COMPLEXJOBS"];

    if (!action) {
      return respond(400, { error: "action ontbreekt", allowedActions });
    }

    // ============================================================
    // Router
    // ============================================================

    // ALL complexes
    if (action === "LIST_ALLCOMPLEXJOBS") {
      const payload = { Action: "LIST_VENDORJOBS_ALL_COMPLEXES", Email: email };
      const r = await callUltimo(cfg, payload);
      const out = getOutputObject(r.json) ?? r.json;

      return respond(200, {
        ok: true,
        env: cfg.name,
        action,
        email,
        result: out,
      });
    }

    // ONE complex (fast path) - vendorId verplicht
    if (action === "LIST_COMPLEXJOBS") {
      if (!complexId) {
        return respond(400, {
          error: "complexId ontbreekt",
          debug: { receivedParams: params },
        });
      }

      if (!vendorId) {
        return respond(400, {
          error: "vendorId ontbreekt",
          debug: { receivedParams: params },
        });
      }

      const payload = {
        Action: "LIST_VENDORJOBS_BY_COMPLEX",
        Email: email,
        ComplexId: complexId, // moet matchen met je Ultimo workflow input-property
        VendorId: vendorId,   // 👈 doorsturen naar Ultimo
      };

      console.log("[vendorlist] LIST_COMPLEXJOBS payload:", payload);

      const r = await callUltimo(cfg, payload);
      const out = getOutputObject(r.json) ?? r.json;

      return respond(200, {
        ok: true,
        env: cfg.name,
        action,
        email,
        complexId,
        vendorId,
        result: out,
      });
    }

    return respond(400, {
      error: "Onbekende action",
      receivedAction: action,
      allowedActions,
    });
  } catch (err) {
    console.error("vendorlist error", err);
    return respond(500, { error: err.message || String(err) });
  }
}
