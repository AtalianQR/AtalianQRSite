// netlify/functions/jobsvendor.js

// === Config uit omgeving ===
const API_KEY        = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD  = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST  = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL; // fallback
const APP_ELEMENT    = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION  = "_rest_QueryAtalianJobs";

// === CORS helper ===
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

// === Kleine helpers ===
const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

const stripHtml = (s = "") =>
  String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const getDomain = (e = "") => {
  const m = String(e).toLowerCase().match(/@(.+)$/);
  return m ? m[1] : "";
};

// === Detecteer omgeving ===
function detectEnvironment(event) {
  const params = event.queryStringParameters || {};
  const host   = event.headers?.host || '';
  const testInUrl  = params.test === '1' || params.test === 'true';
  const testInHost = /test|staging/i.test(host);
  const isTest = testInUrl || testInHost;

  const base = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  const envName = isTest ? 'TEST' : 'PROD';
  console.log(`[jobsvendor] Environment: ${envName} | Host=${host} | testParam=${params.test || ''}`);

  return { isTest, base, envName };
}

// === Standaard JSON response helper ===
function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(bodyObj),
  };
}

// === Ultimo-call helper (met dynamische BASE_URL) ===
async function callUltimo(event, payload) {
  const { base, envName } = detectEnvironment(event);
  console.log(`[jobsvendor] callUltimo via ${envName}: ${payload.Action || 'n/a'}`);

  const res = await fetch(`${base}/action/${ULTIMO_ACTION}`, {
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

  const contentType = res.headers.get("content-type") || "";
  let json;
  if (contentType.includes("application/json")) {
    json = await res.json().catch(e => {
      throw new Error(`Fout bij parsen van JSON: ${e.message}`);
    });
  } else {
    const text = await res.text().catch(() => '');
    console.error("⚠ Ultimo gaf geen JSON:", text.slice(0, 200));
    json = {};
  }
  return { ok: true, json };
}

/**
 * Output.object kan "true"/"false", een JSON-string ({QRCommando, Jobs:[...]}),
 * of een ruwe Base64-string zijn (bij GET_JOB_DOC).
 */
function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  let txt = String(s).trim();

  // 🧹 Clean up control chars en illegal linebreaks
  txt = txt
    .replace(/&quot;/g, '"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/[\u0000-\u001F]+/g, " "); // overige control chars

  if (txt.startsWith("{") && txt.endsWith("}")) {
    try {
      return JSON.parse(txt);
    } catch (e) {
      console.error("[Ultimo] ⚠ getOutputObject parsefout:", e.message);
      // Debug: toon eerste 300 tekens zodat je kan zien waar het knalt
      console.log("[Ultimo] ⇢ JSON (start):", txt.slice(0, 300));
    }
  }
  return txt;
}

function pickFirstJob(out) {
  if (!out || typeof out !== "object") return null;
  if (!Array.isArray(out.Jobs)) return null;
  return out.Jobs[0] || null;
}

function pickDocuments(out) {
  if (!out || typeof out !== "object") return [];
  return Array.isArray(out.Documents) ? out.Documents : [];
}

// === Netlify handler ===
export async function handler(event) {
  try {
    // Preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Simpele sanity check op env
    if (!API_KEY || !BASE_URL_PROD || !APP_ELEMENT) {
      return respond(500, { error: "Serverconfig onvolledig: ontbrekende API-sleutels of BASE_URL_PROD." });
    }

    // Log gekozen omgeving en base
    const { envName, base } = detectEnvironment(event);
    console.log(`[jobsvendor] 🔎 Handler start in ${envName} → base=${base}`);

    /* ───────────── GET ───────────── */
    if (event.httpMethod === "GET") {
      const { jobId, email = "", action = "VIEW", controle, docId } = event.queryStringParameters || {};
      const hasEmail = isNonEmpty(email);

      // 0) Eén document-inhoud (Base64) opvragen
      if (action === "GET_JOB_DOC") {
        if (!docId || !/^\d+$/.test(docId)) {
          return respond(400, { error: "Ongeldig of ontbrekend 'docId'." });
        }
        const r = await callUltimo(event, { Action: "GET_JOB_DOC", objdocid: String(docId) });
        const out = getOutputObject(r.json); // ruwe Base64
        return respond(200, { docId: String(docId), Document: out });
      }

      // 1) Lijst met documenten bij een job
      if (action === "LIST_JOB_DOCS") {
        if (!jobId || !/^\d+$/.test(jobId)) {
          return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
        }
        const r = await callUltimo(event, { Action: "LIST_JOB_DOCS", JobId: String(jobId) });
        const out = getOutputObject(r.json);
        const docs = pickDocuments(out);
        return respond(200, { jobId: String(jobId), Documents: docs });
      }

      // 2) Domeincontrole (frontend login check)
      if (typeof controle !== "undefined") {
        if (!jobId || !/^\d+$/.test(jobId)) {
          return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
        }

        // Eerst VIEW om vendor te kennen; Email enkel meesturen indien aanwezig
        const viewPayload = { JobId: String(jobId), Action: "VIEW" };
        if (hasEmail) viewPayload.Email = email.trim();

        const view = await callUltimo(event, viewPayload);
        const vOut = getOutputObject(view.json);
        const job = pickFirstJob(vOut);
        const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
        const hasVendor = isNonEmpty(vendorEmail);

        // Geen email of geen vendor? => controle niet relevant -> allowed
        if (!(hasEmail && hasVendor)) {
          return respond(200, { allowed: true });
        }

        // Echte check
        const payload = {
          JobId: String(jobId),
          Email: email.trim(),
          Controle: email.trim(),
          ControleDomain: getDomain(email),
          LoginDomain: getDomain(email),
          VendorDomain: getDomain(vendorEmail),
          Action: "VIEW",
        };
        const chk = await callUltimo(event, payload);
        const out = getOutputObject(chk.json);
        const allowed = String(out).toLowerCase() === "true";
        return respond(200, { allowed });
      }

      // 3) Standaard VIEW (geen side effects)
      if (!jobId || !/^\d+$/.test(jobId)) {
        return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
      }
      const viewPayload = { JobId: String(jobId), Action: action };
      if (hasEmail) viewPayload.Email = email.trim();

      const r = await callUltimo(event, viewPayload);
      const out = getOutputObject(r.json);
      const job = pickFirstJob(out);
      if (!job) return respond(404, { error: "Job niet gevonden." });
      if (job.Description) job.Description = stripHtml(job.Description);

      return respond(200, { jobId: String(jobId), email: hasEmail ? email.trim() : null, Job: job, hasDetails: true });
    }

    /* ───────────── POST ───────────── */
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, jobId, email, text = "", fileName, mimeType, description, base64 } = body || {};
      const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email') && isNonEmpty(email);

      if (!jobId || !/^\d+$/.test(jobId)) {
        return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
      }
      if (!action || !["ADD_INFO", "CLOSE", "ADD_JOB_DOC"].includes(action)) {
        return respond(400, { error: "Ongeldige of ontbrekende 'action'." });
      }

      // 1) VIEW om job + vendor te kennen (Email enkel meesturen indien aanwezig)
      const viewPayload = { JobId: String(jobId), Action: "VIEW" };
      if (hasEmail) viewPayload.Email = email.trim();

      const firstView = await callUltimo(event, viewPayload);
      const vOut = getOutputObject(firstView.json);
      const job = pickFirstJob(vOut);
      const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
      const hasVendor = isNonEmpty(vendorEmail);

      // 2) Vendor-check enkel als zowel email als vendor bestaan
      let allowed = true;
      if (hasEmail && hasVendor) {
        const checkPayload = {
          JobId: String(jobId),
          Email: email.trim(),
          Controle: email.trim(),
          ControleDomain: getDomain(email),
          LoginDomain: getDomain(email),
          VendorDomain: getDomain(vendorEmail),
          Action: "VIEW",
        };
        const chk = await callUltimo(event, checkPayload);
        const outChk = getOutputObject(chk.json);
        allowed = String(outChk).toLowerCase() === "true";
      }

      if (!allowed) {
        return respond(403, { error: "E-mailadres niet toegestaan voor deze job/leverancier." });
      }

      // 3) Mutaties
      if (action === "ADD_JOB_DOC") {
        if (!fileName || typeof base64 !== "string" || !base64.length) {
          return respond(400, { error: "Ontbrekende 'fileName' of 'base64'." });
        }
        const addDocPayload = {
          JobId: String(jobId),
          Action: "ADD_JOB_DOC",
          AddDoc_FileName: String(fileName),
          AddDoc_Base64: String(base64),
          AddDoc_Description: String(description || fileName),
          // mimeType NIET doorgeven; bestaat niet als veld in Document-model
        };
        if (hasEmail) addDocPayload.Email = email.trim();

        const rAdd = await callUltimo(event, addDocPayload);
        const out = getOutputObject(rAdd.json);
        return respond(200, { ok: true, jobId: String(jobId), action, result: out });
      }

      // ADD_INFO of CLOSE
      const ultPayload =
        action === "ADD_INFO"
          ? { JobId: String(jobId), Action: "ADD_INFO", Text: String(text || "") }
          : { JobId: String(jobId), Action: "CLOSE",    Text: String(text || "") };
      if (hasEmail) ultPayload.Email = email.trim();

      const r = await callUltimo(event, ultPayload);
      return respond(200, { ok: true, jobId, action });
    }

    return { statusCode: 405, headers: corsHeaders, body: "Methode niet toegestaan" };
  } catch (err) {
    console.error("jobsvendor error", err);
    return respond(500, { error: err.message });
  }
}
