// netlify/functions/jobdocupload.js
// Upload job document to Ultimo (zonder vendor-koppeling)
// Vereiste env vars (zelfde contract als jobsvendor.js):
// - ULTIMO_API_BASEURL
// - ULTIMO_API_BASEURL_TEST
// - ULTIMO_API_KEY
// - (optioneel) ULTIMO_API_KEY_TEST
// - APP_ELEMENT_QueryAtalianJobs
// - (optioneel) APP_ELEMENT_QueryAtalianJobs_TEST

const ULTIMO_ACTION = "_rest_QueryAtalianJobs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-atalian-env",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(bodyObj),
  };
}

function isNonEmpty(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isTestRequested(event, bodyEnv = "") {
  const qs = event.queryStringParameters || {};
  const hdr = event.headers || {};
  const h = (k) => String(hdr[k] || hdr[k?.toLowerCase()] || "").toLowerCase();

  const ref = h("referer");
  const org = h("origin");
  const xenv = h("x-atalian-env");
  const bodyE = String(bodyEnv || "").toLowerCase();

  if (qs.test === "1" || qs.test === "true" || String(qs.env || "").toLowerCase() === "test") return true;
  if (xenv === "test") return true;
  if (bodyE === "test") return true;
  if (/\b(test=1|env=test)\b/i.test(ref)) return true;
  if (/localhost:8888/.test(org)) return true;

  return false;
}

function buildEnvConfig(event, bodyEnv) {
  const isTest = isTestRequested(event, bodyEnv);

  const prod = {
    name: "PROD",
    base: process.env.ULTIMO_API_BASEURL,
    key: process.env.ULTIMO_API_KEY,
    app: process.env.APP_ELEMENT_QueryAtalianJobs,
  };

  const test = {
    name: "TEST",
    base: process.env.ULTIMO_API_BASEURL_TEST,
    key: process.env.ULTIMO_API_KEY_TEST || process.env.ULTIMO_API_KEY,
    app: process.env.APP_ELEMENT_QueryAtalianJobs_TEST || process.env.APP_ELEMENT_QueryAtalianJobs,
  };

  const cfg = isTest ? test : prod;

  // Fail fast
  if (isTest && (!cfg.base || cfg.base === prod.base)) {
    throw new Error("TEST gevraagd maar ULTIMO_API_BASEURL_TEST ontbreekt of is gelijk aan PROD.");
  }
  if (!cfg.base || !cfg.key || !cfg.app) {
    throw new Error(`Serverconfig onvolledig voor ${cfg.name}: base/key/app ontbreken.`);
  }

  return cfg;
}

export async function handler(event) {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");

    const jobId = String(body.jobId || body.JobId || "").trim();
    const fileName = String(body.fileName || "").trim();
    const base64 = String(body.base64 || "");
    const description = String(body.description || "").trim();
    const email = String(body.email || "").trim(); // optioneel
    const env = String(body.env || "").trim();     // optioneel (frontend kan ?test=1 gebruiken)

    if (!jobId || !/^\d+$/.test(jobId)) {
      return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
    }
    if (!fileName) {
      return respond(400, { error: "Ontbrekende 'fileName'." });
    }
    if (!base64) {
      return respond(400, { error: "Ontbrekende 'base64'." });
    }

    // Netlify payload limieten → base64 groeit snel (hou het klein) 
    if (base64.length > 6_000_000) {
      return respond(413, { error: "Bestand te groot voor upload via functie (payload-limiet)." });
    }

    const cfg = buildEnvConfig(event, env);

    const ultimoPayload = {
      Action: "ADD_JOB_DOC",
      JobId: jobId,
      AddDoc_FileName: fileName,
      AddDoc_Base64: base64,
      AddDoc_Description: description || fileName,
    };

    // Email alleen meesturen als het er is (geen undefined rommel)
    if (isNonEmpty(email)) {
      ultimoPayload.Email = email;
    }

    const res = await fetch(`${cfg.base}/action/${ULTIMO_ACTION}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ApiKey: cfg.key,
        ApplicationElementId: cfg.app,
      },
      body: JSON.stringify(ultimoPayload),
    });

    const text = await res.text();

    if (!res.ok) {
      return respond(res.status, {
        error: "Ultimo upload mislukt",
        ultimoResponse: text,
        env: cfg.name,
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: text, // Ultimo geeft soms plain text / soms JSON-string terug
    };
  } catch (err) {
    return respond(500, {
      error: "Serverfout in jobdocupload",
      message: err?.message || String(err),
    });
  }
}
