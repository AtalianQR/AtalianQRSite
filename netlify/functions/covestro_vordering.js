// netlify/functions/covestro_vordering.js

const API_KEY         = process.env.ULTIMO_API_KEY;
const BASE_URL        = process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT     = process.env.APP_ELEMENT_QueryAtalianJobs;
const PORTAL_PASSWORD = process.env.COVESTRO_PORTAL_PASSWORD;
const ULTIMO_ACTION   = "_rest_QueryAtalianJobs";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-portal-password',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function respond(statusCode, bodyObj) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(bodyObj) };
}

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
    const text = await res.text().catch(() => '');
    throw new Error(`Ultimo API fout (${res.status}): ${text}`);
  }
  return res.json();
}

function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  const txt = String(s).trim();
  if (txt.startsWith("{") && txt.endsWith("}")) {
    try {
      return JSON.parse(txt);
    } catch (e) {
      console.error("[covestro_vordering] parsefout:", e.message);
    }
  }
  return txt;
}

function isLocalDev(event) {
  const host = String((event.headers || {}).host || '');
  return process.env.NETLIFY_DEV === 'true' || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

function checkPassword(event) {
  if (isLocalDev(event)) return true; // localhost: geen wachtwoord nodig
  const headers = event.headers || {};
  const headerPw = headers['x-portal-password'] || headers['X-Portal-Password'] || '';
  return !!PORTAL_PASSWORD && headerPw === PORTAL_PASSWORD;
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    const needPassword = !isLocalDev(event);
    if (!API_KEY || !BASE_URL || !APP_ELEMENT || (needPassword && !PORTAL_PASSWORD)) {
      return respond(500, { error: "Serverconfig onvolledig: ontbrekende API-sleutels, BASE_URL of wachtwoord." });
    }

    if (!checkPassword(event)) {
      return respond(401, { error: "Ongeldig of ontbrekend wachtwoord." });
    }

    if (event.httpMethod === 'GET') {
      const qs = event.queryStringParameters || {};
      const action = String(qs.action || '').trim().toUpperCase();

      if (action === 'CHECK_PASSWORD') {
        return respond(200, { ok: true });
      }

      if (action === 'LIST_TO_INVOICE') {
        const raw = await callUltimo({ Action: 'LIST_TO_INVOICE' });
        const out = getOutputObject(raw);
        const jobs = Array.isArray(out?.Jobs) ? out.Jobs : [];
        // Jobs met een 00633-lijn (nacalculatie, kost nog niet gekend) komen niet in Jobs,
        // maar apart in PendingJobs zodat de frontend ze onderaan als 'blijft hangen' toont.
        const pendingJobs = Array.isArray(out?.PendingJobs) ? out.PendingJobs : [];
        return respond(200, { ok: true, Jobs: jobs, PendingJobs: pendingJobs });
      }

      return respond(400, { error: `Onbekende action: ${action}` });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = String(body.action || '').trim().toUpperCase();

      if (action === 'SET_VORDERING') {
        const jobIds = Array.isArray(body.jobIds) ? body.jobIds.map(String).filter(Boolean) : [];
        const vorderingsnummer = String(body.vorderingsnummer || '').trim();

        if (!jobIds.length) {
          return respond(400, { error: "jobIds ontbreekt of is leeg." });
        }
        if (!vorderingsnummer) {
          return respond(400, { error: "vorderingsnummer ontbreekt." });
        }

        // Ultimo bindt een JSON-array niet correct als REST-inputparameter (List[UltimoString]
        // bleek leeg te blijven). Daarom roepen we de actie hier per job afzonderlijk aan met
        // een gewone enkele JobId-string, en bouwen we de Results-lijst zelf op.
        const results = [];
        for (const jobId of jobIds) {
          try {
            const raw = await callUltimo({
              Action: 'SET_VORDERING',
              JobId: jobId,
              Vorderingsnummer: vorderingsnummer,
            });
            const out = getOutputObject(raw);
            if (out && typeof out === 'object' && 'Success' in out) {
              results.push(out);
            } else {
              results.push({ JobId: jobId, Success: false, Message: 'Onverwacht antwoord van Ultimo.' });
            }
          } catch (err) {
            results.push({ JobId: jobId, Success: false, Message: err.message });
          }
        }

        return respond(200, { ok: true, Results: results });
      }

      return respond(400, { error: `Onbekende action: ${action}` });
    }

    return respond(405, { error: "Methode niet toegestaan." });
  } catch (err) {
    console.error("covestro_vordering error", err);
    return respond(500, { error: err.message });
  }
}
