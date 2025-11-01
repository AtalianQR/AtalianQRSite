// netlify/functions/jobsvendor.js

// === Config uit omgeving (onveranderd) ===
const API_KEY         = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD   = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST   = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL; // fallback
const APP_ELEMENT     = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION   = "_rest_QueryAtalianJobs";

// === CORS helper (onveranderd) ===
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

// === Kleine helpers (onveranderd) ===
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

// === Detecteer omgeving (onveranderd) ===
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

// === Standaard JSON response helper (onveranderd) ===
function respond(statusCode, bodyObj) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(bodyObj),
  };
}

// === Ultimo-call helper (met dynamische BASE_URL) (onveranderd) ===
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

// === Netlify handler (Gerefractoriseerde Versie) ===

// Mock headers en helpers (verondersteld beschikbaar in de oorspronkelijke code)
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
// ... andere imports/helpers (respond, callUltimo, getOutputObject, pickDocuments, pickFirstJob, isNonEmpty, getDomain, stripHtml)

// Veronderstelde globale constanten (uit de oorspronkelijke code)
// const { API_KEY, BASE_URL_PROD, APP_ELEMENT } = process.env; 

/**
 * Helper: Extractor en Validator voor de Job ID.
 */
function getCleanJobId(params) {
  const jobIdRaw = (params.jobId || params.job || '').trim();
  // Gebruikt de oorspronkelijke robuuste, maar specifieke, regex.
  const jobIdClean = decodeURIComponent(jobIdRaw).match(/^\d+/)?.[0] || '';
  return jobIdClean;
}

/**
 * Helper: Voert de Vendor/Domein controle uit.
 * @returns {Promise<boolean>} Of de actie is toegestaan.
 */
async function checkVendorAccess(event, jobIdClean, email, vendorEmail) {
  const hasEmail = isNonEmpty(email);
  const hasVendor = isNonEmpty(vendorEmail);
  
  // Geen email of geen vendor? => Altijd toegestaan voor deze check
  if (!(hasEmail && hasVendor)) {
    return true;
  }

  // Echte check uitvoeren met alle domeininfo
  const checkPayload = {
    JobId: jobIdClean,
    Email: email.trim(),
    Controle: email.trim(),
    ControleDomain: getDomain(email),
    LoginDomain: getDomain(email),
    VendorDomain: getDomain(vendorEmail),
    Action: "VIEW", // Misleidende Action-naam, maar behouden conform de Ultimo API
  };
  
  const chk = await callUltimo(event, checkPayload);
  const out = getOutputObject(chk.json);
  
  return String(out).toLowerCase() === "true";
}


/* ───────────── GET HANDLERS ───────────── */

async function handleGetJobDoc(event, { docId }) {
  if (!docId || !/^\d+$/.test(docId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'docId'." });
  }
  const r = await callUltimo(event, { Action: "GET_JOB_DOC", objdocid: String(docId) });
  const out = getOutputObject(r.json);
  return respond(200, { docId: String(docId), Document: out });
}

async function handleListJobDocs(event, { jobIdClean }) {
  const r = await callUltimo(event, { Action: "LIST_JOB_DOCS", JobId: jobIdClean });
  const out = getOutputObject(r.json);
  const docs = pickDocuments(out);
  return respond(200, { jobId: jobIdClean, Documents: docs });
}

async function handleGetDomainCheck(event, { jobIdClean, email }) {
  // Eerst VIEW om vendor te kennen; Email enkel meesturen indien aanwezig
  const viewPayload = { JobId: jobIdClean, Action: "VIEW" };
  if (isNonEmpty(email)) viewPayload.Email = email.trim();

  const view = await callUltimo(event, viewPayload);
  const vOut = getOutputObject(view.json);
  const job = pickFirstJob(vOut);
  const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";

  const allowed = await checkVendorAccess(event, jobIdClean, email, vendorEmail);
  return respond(200, { allowed });
}

async function handleDefaultView(event, { jobIdClean, email, action }) {
  const hasEmail = isNonEmpty(email);
  const viewPayload = { JobId: jobIdClean, Action: action };
  if (hasEmail) viewPayload.Email = email.trim();

  const r = await callUltimo(event, viewPayload);
  const out = getOutputObject(r.json);
  const job = pickFirstJob(out);
  
  if (!job) {
    return respond(404, { error: "Job niet gevonden." });
  }
  
  if (job.Description) job.Description = stripHtml(job.Description);

  return respond(200, { 
    jobId: jobIdClean, 
    email: hasEmail ? email.trim() : null, 
    Job: job, 
    hasDetails: true 
  });
}


/* ───────────── POST HANDLERS ───────────── */

async function handleAddJobDoc(event, { jobIdClean, email, fileName, description, base64 }) {
  if (!fileName || typeof base64 !== "string" || !base64.length) {
    return respond(400, { error: "Ontbrekende 'fileName' of 'base64'." });
  }
  
  const addDocPayload = {
    JobId: jobIdClean,
    Action: "ADD_JOB_DOC",
    AddDoc_FileName: String(fileName),
    AddDoc_Base64: String(base64),
    AddDoc_Description: String(description || fileName),
  };
  if (isNonEmpty(email)) addDocPayload.Email = email.trim();

  const rAdd = await callUltimo(event, addDocPayload);
  const out = getOutputObject(rAdd.json);
  return respond(200, { ok: true, jobId: jobIdClean, action: "ADD_JOB_DOC", result: out });
}

async function handlePostAction(event, { jobIdClean, body, action, email, text }) {
    // 1) Eerste VIEW om job + vendor te kennen
    const viewPayload = { JobId: jobIdClean, Action: "VIEW" };
    if (isNonEmpty(email)) viewPayload.Email = email.trim();

    const firstView = await callUltimo(event, viewPayload);
    const vOut = getOutputObject(firstView.json);
    const jobDetails = pickFirstJob(vOut); 
    const vendorEmail = jobDetails?.VendorEmailAddress || jobDetails?.Vendor?.EmailAddress || "";

    // 2) Vendor-check
    const allowed = await checkVendorAccess(event, jobIdClean, email, vendorEmail);

    if (!allowed) {
      return respond(403, { error: "E-mailadres niet toegestaan voor deze job/leverancier." });
    }
    
    // 3) Mutaties (Acties 'ADD_INFO' en 'CLOSE' - 'ADD_JOB_DOC' wordt apart behandeld)
    
    // Payload voor ADD_INFO of CLOSE
    const mutationPayload = { JobId: jobIdClean, Action: action };
    if (isNonEmpty(email)) mutationPayload.Email = email.trim();
    if (isNonEmpty(text) && action === "ADD_INFO") mutationPayload.Text = text;

    // ... Eventueel meer logica voor CLOSE/ADD_INFO afhankelijk van de Ultimo API

    const r = await callUltimo(event, mutationPayload);
    const out = getOutputObject(r.json);
    return respond(200, { ok: true, jobId: jobIdClean, action, result: out });
}


// ----------------------------------------------------------------------
// 🚨 Hoofd Handler
// ----------------------------------------------------------------------

export async function handler(event) {
  try {
    // Preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Sanity check op env
    if (!API_KEY || !BASE_URL_PROD || !APP_ELEMENT) {
      return respond(500, { error: "Serverconfig onvolledig: ontbrekende API-sleutels of BASE_URL_PROD." });
    }

    // Log gekozen omgeving en base
    const { envName, base } = detectEnvironment(event);
    console.log(`[jobsvendor] 🔎 Handler start in ${envName} → base=${base}`);

    /* ───────────── GET ───────────── */
    if (event.httpMethod === "GET") {
      const { jobId, job, email = "", action = "VIEW", controle, docId } = event.queryStringParameters || {};
      
      // Valideer Job ID
      const jobIdClean = getCleanJobId({ jobId, job });
      if (!jobIdClean) {
        return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
      }
      
      // 0) Eén document-inhoud (Base64) opvragen
      if (action === "GET_JOB_DOC") {
        return handleGetJobDoc(event, { docId });
      }

      // 1) Lijst met documenten bij een job
      if (action === "LIST_JOB_DOCS") {
        return handleListJobDocs(event, { jobIdClean });
      }

      // 2) Domeincontrole (frontend login check)
      if (typeof controle !== "undefined") {
        return handleGetDomainCheck(event, { jobIdClean, email });
      }

      // 3) Standaard VIEW (geen side effects)
      return handleDefaultView(event, { jobIdClean, email, action });
    }

    /* ───────────── POST ───────────── */
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, email, text, fileName, description, base64 } = body;
      
      // Valideer Job ID
      const jobIdClean = getCleanJobId(body);
      if (!jobIdClean) {
        return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
      }
      
      // Valideer Action
      const allowedActions = ["ADD_INFO", "CLOSE", "ADD_JOB_DOC"];
      if (!action || !allowedActions.includes(action)) {
        return respond(400, { error: `Ongeldige of ontbrekende 'action'. Moet één van ${allowedActions.join(', ')} zijn.` });
      }

      // 3) Mutaties: ADD_JOB_DOC (speciale afhandeling vanwege grote body/base64)
      if (action === "ADD_JOB_DOC") {
        return handleAddJobDoc(event, { jobIdClean, email, fileName, description, base64 });
      }
      
      // 4) Overige mutaties (ADD_INFO, CLOSE) inclusief vendor/toegangscheck
      return handlePostAction(event, { jobIdClean, body, action, email, text });
    }
    
    // Ongeaccepteerde HTTP Method
    return respond(405, { error: "Methode niet toegestaan." });

  } catch (error) {
    console.error(`[jobsvendor] 💥 Fout in handler: ${error.message}`, error.stack);
    return respond(500, { error: "Interne serverfout." });
  }
}

      // ADD_INFO of CLOSE
      // Gebruik jobIdClean
      const ultPayload =
        action === "ADD_INFO"
          ? { JobId: jobIdClean, Action: "ADD_INFO", Text: String(text || "") }
          : { JobId: jobIdClean, Action: "CLOSE",    Text: String(text || "") };
      if (hasEmail) ultPayload.Email = email.trim();

      const r = await callUltimo(event, ultPayload);
      return respond(200, { ok: true, jobId: jobIdClean, action });
    }

    return { statusCode: 405, headers: corsHeaders, body: "Methode niet toegestaan" };
  } catch (err) {
    console.error("jobsvendor error", err);
    return respond(500, { error: err.message });
  }
}