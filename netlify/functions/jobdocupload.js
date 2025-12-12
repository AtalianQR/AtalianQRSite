/* netlify/functions/jobdocupload.js */
/* eslint-disable */

const API_KEY        = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD  = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST  = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_ONE        = process.env.APP_ELEMENT_OneAtalianJob;

// -------------------------
// Helpers
// -------------------------
const json = (s, o = {}) => ({
  statusCode: s,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ApiKey, ApplicationElementId'
  },
  body: JSON.stringify(o)
});

const toStr = (v) => String(v ?? '').trim();

function detectEnvironment(event = {}) {
  const qs   = event.queryStringParameters || {};
  const host = (event.headers?.host || '').toLowerCase();

  const isTest =
    qs.test === '1' ||
    qs.test === 'true' ||
    qs.env === 'test' ||
    /test|staging/i.test(host);

  return {
    base: isTest ? BASE_URL_TEST : BASE_URL_PROD,
    env : isTest ? 'TEST' : 'PROD',
    isTest
  };
}

function safeParseUltimo(raw) {
  let txt = String(raw ?? '');
  if (txt.includes("&quot;")) txt = txt.replace(/&quot;/g, '"');

  try {
    const j = JSON.parse(txt);
    if (j?.properties?.Output?.object) {
      const o = j.properties.Output.object;
      return JSON.parse(o.replace(/&quot;/g, '"'));
    }
    if (j?.object) {
      const o = j.object;
      return JSON.parse(o.replace(/&quot;/g, '"'));
    }
    return j;
  } catch {
    return { _raw: txt };
  }
}

// -------------------------
// Handler
// -------------------------
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  if (!API_KEY || !BASE_URL_PROD || !APP_ONE) {
    return json(500, { error: 'Serverconfig ontbreekt (API_KEY/BASE_URL/APP_ELEMENT).' });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Body is geen geldige JSON.' }); }

  const jobId      = toStr(body.jobId);
  const email      = toStr(body.email);
  const fileName   = toStr(body.fileName);
  const base64     = toStr(body.base64);
  const desc       = toStr(body.description || fileName);

  if (!jobId)    return json(400, { error: "jobId ontbreekt" });
  if (!fileName) return json(400, { error: "fileName ontbreekt" });
  if (!base64)   return json(400, { error: "base64 ontbreekt" });

  if (base64.length > 6_000_000) {
    return json(413, { error: "Bestand te groot (~4.5MB limiet)." });
  }

  const { base, env } = detectEnvironment(event);

  const payload = {
    Action: "ADD_JOB_DOC",
    JobId: jobId,
    Email: email || undefined,
    AddDoc_FileName: fileName,
    AddDoc_Description: desc,
    AddDoc_Base64: base64
  };

  try {
    const res = await fetch(`${base}/action/_REST_OneAtalianJob`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        ApiKey: API_KEY,
        ApplicationElementId: APP_ONE
      },
      body: JSON.stringify(payload)
    });

    const txt = await res.text();
    const parsed = safeParseUltimo(txt);

    if (!res.ok) {
      return json(res.status, {
        ok: false,
        env,
        error: 'Upload-fout',
        detail: parsed,
        preview: txt.substring(0, 600),
        sent: { jobId, fileName, size: base64.length }
      });
    }

    return json(200, {
      ok: true,
      env,
      jobId,
      fileName,
      result: parsed
    });

  } catch (err) {
    return json(500, {
      ok: false,
      env,
      error: "Server-error bij upload",
      detail: String(err?.message || err)
    });
  }
}
