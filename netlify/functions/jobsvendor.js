// === netlify/functions/jobsvendor.js (Met VendorId 000016 override) ===

// === Config uit omgeving ===
const API_KEY         = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD   = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST   = process.env.ULTIMO_API_BASEURL_TEST;
const APP_ELEMENT     = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION   = "_rest_QueryAtalianJobs";

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
const emailDomain = (e = "") => getDomain(e);

function isValidJobId(id) {
  return isNonEmpty(id) && /^\d+$/.test(id);
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
  const cfg = buildEnvConfig(event);
  console.log(`[jobsvendor] callUltimo via ${cfg.name}: ${payload.Action || 'n/a'}`);

  const res = await fetch(`${cfg.base}/action/${ULTIMO_ACTION}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      ApiKey: cfg.key,
      ApplicationElementId: cfg.app,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ultimo API fout (${res.status}): ${text}`);
  }
  const contentType = res.headers.get("content-type") || "";
  return { ok: true, json: contentType.includes("application/json") ? await res.json() : {} };
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
      console.log("[Ultimo] ⇢ JSON (start):", txt.slice(0, 300));
    }
  }
  return txt;
}

function pickFirstJob(out) {
  if (!out || typeof out !== "object") return null;

  // 1) Prefer 'Job' object (sommige VIEW responses)
  if (out.Job && typeof out.Job === 'object') return out.Job;
  if (out.job && typeof out.job === 'object') return out.job;

  // 2) Anders 'Jobs' array
  if (Array.isArray(out.Jobs) && out.Jobs.length) return out.Jobs[0];
  if (Array.isArray(out.jobs) && out.jobs.length) return out.jobs[0];

  // 3) Als fallback: als het hele 'out' zelf op Job lijkt
  if (out.Id || out.Description || out.Vendor || out.VendorEmailAddress) return out;

  return null;
}

function pickDocuments(out) {
  if (!out || typeof out !== "object") return [];
  return Array.isArray(out.Documents) ? out.Documents : [];
}

// === OData helper om Vendor.Id op te halen (voor override) ===
async function fetchJobVendorId(event, jobId) {
  const cfg = buildEnvConfig(event);
  const url = `${cfg.base}/object/Job('${String(jobId)}')`;
  const res = await fetch(url, { headers: { accept: 'application/json', ApiKey: cfg.key }});
  if (!res.ok) return '';
  const data = await res.json().catch(()=> ({}));
  const v = data?.Vendor?.Id || data?.properties?.Vendor?.Id || data?.Vendor || data?.properties?.Vendor || '';
  return String((typeof v === 'object' ? v?.Id : v) || '').trim();
}

/* ───────────── GET HANDLERS ───────────── */


function buildEnvConfig(event) {
  const params = event.queryStringParameters || {};
  const host   = event.headers?.host || '';
  const isTest = params.test === '1' || params.test === 'true' || /test|staging/i.test(host);

  const prod = {
    base: process.env.ULTIMO_API_BASEURL,
    key:  process.env.ULTIMO_API_KEY,
    app:  process.env.APP_ELEMENT_QueryAtalianJobs,
    name: 'PROD',
  };

  const test = {
    base: process.env.ULTIMO_API_BASEURL_TEST,     // ⬅️ geen fallback naar prod!
    key:  process.env.ULTIMO_API_KEY_TEST || process.env.ULTIMO_API_KEY, // key mag delen indien nodig
    app:  process.env.APP_ELEMENT_QueryAtalianJobs_TEST || process.env.APP_ELEMENT_QueryAtalianJobs,
    name: 'TEST',
  };
  
 // Optionele domein-afleiding als base voor TEST ontbreekt
  function deriveTestBase(from) {
    if (!from) return '';
    // pas aan aan jouw domeinpatroon
    return from
      .replace('atalian.ultimo.net', 'atalian-test.ultimo.net')
      .replace('api/v1', 'api/v1'); // placeholder indien pad afwijkt
  }

  let cfg = isTest ? test : prod;

  // ❌ Hard fail als test gevraagd is maar geen test-base
  if (isTest && (!cfg.base || cfg.base === prod.base)) {
    // laatste redmiddel: afleiden uit prod
    const derived = deriveTestBase(prod.base);
    if (derived && derived !== prod.base) {
      cfg = { ...cfg, base: derived };
    } else {
      throw new Error("TEST omgeving gevraagd (?test=1) maar ULTIMO_API_BASEURL_TEST ontbreekt.");
    }
  }

  if (!cfg.base || !cfg.key || !cfg.app) {
    throw new Error(`Serverconfig onvolledig voor ${cfg.name}: base/key/app ontbreken.`);
  }

  console.log(`[jobsvendor] Environment: ${cfg.name} | Host=${host} | base=${cfg.base} | testParam=${params.test || ''}`);
  return cfg;
}  

async function handleGetJobDoc(event, { docId }) {
  if (!docId || !/^\d+$/.test(docId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'docId'." });
  }
  const r = await callUltimo(event, { Action: "GET_JOB_DOC", objdocid: String(docId) });
  const out = getOutputObject(r.json);
  return respond(200, { docId: String(docId), Document: out });
}

async function handleListJobDocs(event, { jobId }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }
  const r = await callUltimo(event, { Action: "LIST_JOB_DOCS", JobId: String(jobId) });
  const out = getOutputObject(r.json);
  const docs = pickDocuments(out);
  return respond(200, { jobId: String(jobId), Documents: docs });
}

// === Login/domain check (met VendorId-override) ===
async function handleGetDomainCheck(event, { jobId, email, hasEmail }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }

  // 1) VIEW om basis-gegevens op te halen
  const viewPayload = { JobId: String(jobId), Action: "VIEW" };
  if (hasEmail) viewPayload.Email = email.trim();

  const view = await callUltimo(event, viewPayload);
  const vOut = getOutputObject(view.json);
  const job = pickFirstJob(vOut);

  if (!job) {
    return respond(200, { allowed: false, reason: "Job niet gevonden." });
  }

  const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
  const hasVendor = isNonEmpty(vendorEmail);
  const isAtalianEmail = hasEmail && emailDomain(email) === 'atalianworld.com';

  // === Vendor override via OData: Vendor.Id ===
  if (isAtalianEmail) {
    try {
      const vendorId = await fetchJobVendorId(event, jobId);
      if (vendorId === '000016') {
        // optioneel: debug info bijvoegen wanneer ?debug=1
		const params = event.queryStringParameters || {};
		const extra = params.debug ? { vendorId } : {};
        return respond(200, { allowed: true, override: 'vendor000016', ...extra });
      }
    } catch (_) {
      // geen hard fail; ga door naar standaard check
    }
  }

  // 🛑 STRIKTE CONTROLE: e-mail en vendor-mail moeten aanwezig zijn voor standaard check
  // WIJZIGING 1: Als het een @atalianworld.com e-mail is, bypass dan de !hasVendor check.
  if (!hasEmail || (!hasVendor && !isAtalianEmail)) { 
    const reason = !hasEmail
      ? "E-mail ontbreekt"
      : "Job heeft geen gekoppelde leverancier.";
    return respond(200, { allowed: false, reason });
  }

  // 2) Standaard domein-check
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

// ======================================================================

async function handleDefaultView(event, { jobId, email, action, hasEmail }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }
  const viewPayload = { JobId: String(jobId), Action: action };
  if (hasEmail) viewPayload.Email = email.trim();

  const r = await callUltimo(event, viewPayload);
  const out = getOutputObject(r.json);
  const job = pickFirstJob(out);

  if (!job) {
    return respond(404, { error: "Job niet gevonden." });
  }

  if (job.Description) job.Description = stripHtml(job.Description);

  return respond(200, {
    jobId: String(jobId),
    email: hasEmail ? email.trim() : null,
    Job: job,
    hasDetails: true
  });
}

/* ───────────── POST HANDLERS ───────────── */

// === DROP-IN REPLACEMENT ===
// Vereist dat je al helpers hebt zoals: fetchJob(event, jobId), respond(status, obj)
// Laat je bestaande actiehandlers (ADD_JOB_DOC / ADD_INFO) ONGEWIJZIGD ONDERAAN STAAN.

// VERVANG je huidige handlePostAction volledig door deze versie
async function handlePostAction(event) {
  const qs   = event.queryStringParameters || {};
  const body = (event.body && JSON.parse(event.body)) || {};

  const action = String(qs.action || body.action || "").toUpperCase();
  const jobId  = String(qs.jobId  || body.jobId  || "").trim();
  const email  = String(body.email || qs.email    || "").trim();

  if (!action) return respond(400, { error: "action ontbreekt" });
  if (!jobId)  return respond(400, { error: "jobId ontbreekt" });
  if (!email)  return respond(400, { error: "email ontbreekt" });

  const isAtalian = getDomain(email) === "atalianworld.com";

  // 1) Job ophalen via VIEW (zoals in GET)
  const viewPayload = { JobId: String(jobId), Action: "VIEW", Email: email };
  const firstView   = await callUltimo(event, viewPayload);
  const vOut        = getOutputObject(firstView.json);
  const job         = pickFirstJob(vOut);
  if (!job) return respond(404, { error: `Job ${jobId} niet gevonden` });

  // 2) Vendor-context bepalen
  const vendorEmail    = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
  let vendorId         = String(job?.Vendor?.Id || job?.VendorId || "").trim();

  // resolve vendorId via OData indien nodig
  if (!vendorId) {
    try { vendorId = await fetchJobVendorId(event, jobId); } catch {}
  }

  console.info("[jobsvendor][AUTH]", {
    jobId, email, vendorId, vendorEmail,
    hasVendorEmail: !!vendorEmail, isAtalianMail: isAtalian, action
  });

  // 🚫 harde regel: vendorId verplicht voor POST
  if (!vendorId) {
    console.warn("[jobsvendor][AUTH] deny: AUTH_NO_VENDOR", { jobId, email });
    return respond(403, { error: "Geen leverancier gekoppeld aan deze job.", reason: "AUTH_NO_VENDOR" });
  }

  // 3) Autorisatie
  let allowed = false;

  // ✅ Atalian-vendor override
  if (vendorId === "000016" && isAtalian) {
    allowed = true;
    console.info("[auth] allow: Atalian vendor + Atalian mail");
  } else if (vendorEmail) {
    // domeinmatch voor externe vendors
    const loginDom  = getDomain(email);
    const vendorDom = getDomain(vendorEmail);
    allowed = loginDom && vendorDom && loginDom === vendorDom;
    console.info("[auth] domain-check", { loginDom, vendorDom, allowed });
  } else {
    console.warn("[auth] deny: no vendor email for non-Atalian vendor");
    allowed = false;
  }

  if (!allowed) {
    return respond(403, { error: "E-mailadres niet toegestaan voor deze job/leverancier." });
  }

  // 4) Actie uitvoeren ZONDER externe helpers
  if (action === "ADD_JOB_DOC") {
    const fileName    = String(body.fileName || "").trim();
    const base64      = String(body.base64   || "");
    const description = String(body.description || fileName || "Bijlage");

    if (!fileName || !base64) {
      return respond(400, { error: "Ontbrekende 'fileName' of 'base64'." });
    }
    // ⚠ Tip: check payload-grootte om Netlify-limiet te vermijden (~4,5 MB effectief bij base64)
    if (base64.length > 6_000_000) { // ruwe heuristiek
      return respond(413, { error: "Bestand te groot voor upload via functie (limiet ~4,5MB base64)." });
    }

    const addDocPayload = {
      JobId: String(jobId),
      Action: "ADD_JOB_DOC",
      Email: email,
      AddDoc_FileName: fileName,
      AddDoc_Base64: base64,
      AddDoc_Description: description
    };

    const rAdd = await callUltimo(event, addDocPayload);
    const out  = getOutputObject(rAdd.json);
    return respond(200, { ok: true, jobId, action, result: out });
  }

  if (action === "ADD_INFO" || action === "CLOSE") {
    const text = String(body.text || "");
    const ultPayload =
      action === "ADD_INFO"
        ? { JobId: String(jobId), Action: "ADD_INFO", Email: email, Text: text }
        : { JobId: String(jobId), Action: "CLOSE",    Email: email, Text: text };

    const r = await callUltimo(event, ultPayload);
    const out = getOutputObject(r.json);
    return respond(200, { ok: true, jobId, action, result: out });
  }

  return respond(400, { error: `Onbekende action: ${action}` });
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

    // Sanity
    if (!API_KEY || !BASE_URL_PROD || !APP_ELEMENT) {
      return respond(500, { error: "Serverconfig onvolledig: ontbrekende API-sleutels of BASE_URL_PROD." });
    }

	// Log gekozen omgeving en base (één bron: buildEnvConfig)
	const cfg = buildEnvConfig(event);
	console.log(`[jobsvendor] 🔎 Handler start in ${cfg.name} → base=${cfg.base}`);

    /* ───────────── GET ───────────── */
    if (event.httpMethod === "GET") {
      const { jobId, email = "", action = "VIEW", controle, docId } = event.queryStringParameters || {};
      const hasEmail = isNonEmpty(email);
      const params = { jobId, email, action, controle, docId, hasEmail };

      if (action === "GET_JOB_DOC")  return handleGetJobDoc(event, params);
      if (action === "LIST_JOB_DOCS") return handleListJobDocs(event, params);
      if (typeof controle !== "undefined") return handleGetDomainCheck(event, params);

      // Default: VIEW
      return handleDefaultView(event, params);
    }

    /* ───────────── POST ───────────── */
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, jobId, email, text, fileName, description, base64 } = body || {};
      const hasEmail = Object.prototype.hasOwnProperty.call(body, 'email') && isNonEmpty(email);

      return handlePostAction(event, body, {
        jobId, email, hasEmail, action, text, fileName, description, base64
      });
    }

    return respond(405, { error: "Methode niet toegestaan." });

  } catch (err) {
    console.error("jobsvendor error", err);
    return respond(500, { error: err.message });
  }
}