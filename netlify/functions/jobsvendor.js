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
// 🚀 FIX: Verwacht nu 'cfg' in plaats van 'event'
async function callUltimo(cfg, payload) { 
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
// 🚀 FIX: Verwacht nu 'cfg' in plaats van 'event'
async function fetchJobVendorId(cfg, jobId) { 
    const url = `${cfg.base}/object/Job('${String(jobId)}')`;
    const res = await fetch(url, { headers: { accept: 'application/json', ApiKey: cfg.key }});
    if (!res.ok) return '';
    const data = await res.json().catch(()=> ({}));
    const v = data?.Vendor?.Id || data?.properties?.Vendor?.Id || data?.Vendor || data?.properties?.Vendor || '';
    return String((typeof v === 'object' ? v?.Id : v) || '').trim();
}

/* ───────────── GET HANDLERS ───────────── */


function isTestRequested(event) {
  const qs  = event.queryStringParameters || {};
  const hdr = event.headers || {};
  const h   = (k) => String(hdr[k] || hdr[k?.toLowerCase()] || "").toLowerCase();
  const ref = h("referer");   // volledige pagina-URL
  const org = h("origin");    // bv. http://localhost:8888
  const xenv= h("x-atalian-env"); // expliciete override vanuit frontend

  // 1) Expliciet in query
  if (qs.test === "1" || qs.test === "true" || (qs.env || "").toLowerCase() === "test") return true;
  // 2) Expliciet via header
  if (xenv === "test") return true;
  // 3) Overgenomen uit Referer (UI url)
  if (/\b(test=1|env=test)\b/i.test(ref)) return true;
  // 4) Lokale dev: origin localhost ⇒ default naar TEST tenzij expliciet tegengehouden
  if (/localhost:8888/.test(org)) return true;

  return false;
}

function buildEnvConfig(event) {
  const isTest = isTestRequested(event);
  const host   = event.headers?.host || "";

  const prod = {
    base: process.env.ULTIMO_API_BASEURL,
    key:  process.env.ULTIMO_API_KEY,
    app:  process.env.APP_ELEMENT_QueryAtalianJobs,
    name: "PROD",
  };

  const test = {
    base: process.env.ULTIMO_API_BASEURL_TEST, // geen fallback naar PROD!
    key:  process.env.ULTIMO_API_KEY_TEST || process.env.ULTIMO_API_KEY,
    app:  process.env.APP_ELEMENT_QueryAtalianJobs_TEST || process.env.APP_ELEMENT_QueryAtalianJobs,
    name: "TEST",
  };

  let cfg = isTest ? test : prod;

  // Fail fast als TEST gevraagd is maar niet geconfigureerd
  if (isTest && (!cfg.base || cfg.base === prod.base)) {
    throw new Error("TEST gevraagd maar ULTIMO_API_BASEURL_TEST ontbreekt of is gelijk aan PROD.");
  }

  if (!cfg.base || !cfg.key || !cfg.app) {
    throw new Error(`Serverconfig onvolledig voor ${cfg.name}: base/key/app ontbreken.`);
  }

  console.log(`[jobsvendor] Env=${cfg.name} | Host=${host} | Base=${cfg.base}`);
  return cfg;
}

// 🚀 FIX: Verwacht nu 'cfg' in plaats van 'event'
async function handleGetJobDoc(cfg, { docId }) {
  if (!docId || !/^\d+$/.test(docId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'docId'." });
  }
  // 🚀 FIX: callUltimo gebruikt nu 'cfg'
  const r = await callUltimo(cfg, { Action: "GET_JOB_DOC", objdocid: String(docId) });
  const out = getOutputObject(r.json);
  return respond(200, { docId: String(docId), Document: out });
}

// 🚀 FIX: Verwacht nu 'cfg' in plaats van 'event'
async function handleListJobDocs(cfg, { jobId }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }
  // 🚀 FIX: callUltimo gebruikt nu 'cfg'
  const r = await callUltimo(cfg, { Action: "LIST_JOB_DOCS", JobId: String(jobId) });
  const out = getOutputObject(r.json);
  const docs = pickDocuments(out);
  return respond(200, { jobId: String(jobId), Documents: docs });
}

// === Login/domain check (met VendorId-override) ===
// 🚀 FIX: Verwacht nu 'cfg' in plaats van 'event'
async function handleGetDomainCheck(cfg, { jobId, email, hasEmail }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }

  // 1) VIEW om basis-gegevens op te halen
  const viewPayload = { JobId: String(jobId), Action: "VIEW" };
  if (hasEmail) viewPayload.Email = email.trim();

  // 🚀 FIX: callUltimo gebruikt nu 'cfg'
  // (Fout gebeurde hier niet, maar de 500-fout op de server kan de controle flow breken)
  const view = await callUltimo(cfg, viewPayload);
  const vOut = getOutputObject(view.json);
  const job = pickFirstJob(vOut);

  if (!job) {
    return respond(200, { allowed: false, reason: "Job niet gevonden." });
  }

  const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
  const isAtalianEmail = hasEmail && emailDomain(email) === 'atalianworld.com';
  
  // 🚀 FIX: Haal Vendor ID direct op uit de VIEW call (deze bevat nu de ID)
  const vendorId = String(job?.Vendor?.Id || job?.VendorId || "").trim();
  const hasVendor = isNonEmpty(vendorEmail);

  // === Atalian Vendor 000016 Override (gebaseerd op VIEW data, ZONDER ODATA) ===
  if (isAtalianEmail && vendorId === '000016') {
    console.log("[auth] allow: Atalian vendor + Atalian mail (GET bypass)");
    // De debug-logica die 'event' nodig had is verwijderd voor stabiliteit
    return respond(200, { allowed: true, override: 'vendor000016' });
  }

  // 🛑 STRIKTE CONTROLE: e-mail en vendor-mail moeten aanwezig zijn voor standaard check
  // WIJZIGING 1: Als het een @atalianworld.com e-mail is, bypass dan de !hasVendor check.
  if (!hasEmail || (!hasVendor && !isAtalianEmail)) { 
    const reason = !hasEmail
      ? "E-mail ontbreekt"
      : "Job heeft geen gekoppelde leverancier.";
    return respond(200, { allowed: false, reason });
  }

  // 2) Standaard domein-check (valt terug op de CONTROLE actie in Ultimo)
  const payload = {
    JobId: String(jobId),
    Email: email.trim(),
    Controle: email.trim(),
    ControleDomain: getDomain(email),
    LoginDomain: getDomain(email),
    VendorDomain: getDomain(vendorEmail),
    Action: "VIEW",
  };
  // 🚀 FIX: callUltimo gebruikt nu 'cfg'
  const chk = await callUltimo(cfg, payload);
  const out = getOutputObject(chk.json);
  const allowed = String(out).toLowerCase() === "true";
  return respond(200, { allowed });
}

// ======================================================================

// 🚀 FIX: Verwacht nu 'cfg' in plaats van 'event'
async function handleDefaultView(cfg, { jobId, email, action, hasEmail }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }
  const viewPayload = { JobId: String(jobId), Action: action };
  if (hasEmail) viewPayload.Email = email.trim();

  // 🚀 FIX: callUltimo gebruikt nu 'cfg'
  const r = await callUltimo(cfg, viewPayload);
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

// 🚀 FIX: Verwacht nu 'cfg' als derde argument
async function handlePostAction(event, body, cfg) {
    const qs   = event.queryStringParameters || {};
    const action = String(qs.action || body.action || "").toUpperCase();
    const jobId  = String(qs.jobId  || body.jobId  || "").trim();
    const email  = String(body.email || qs.email    || "").trim();

    if (!action) return respond(400, { error: "action ontbreekt" });
    if (!jobId)  return respond(400, { error: "jobId ontbreekt" });
    if (!email)  return respond(400, { error: "email ontbreekt" });

    const isAtalian = getDomain(email) === "atalianworld.com";

    // 1) Job ophalen via VIEW (De Workflow geeft nu VendorId en VendorEmailAddress)
    const viewPayload = { JobId: String(jobId), Action: "VIEW", Email: email };
    // We gebruiken de correcte 'cfg' (TEST/PROD) voor de Ultimo aanroep
    const firstView   = await callUltimo(cfg, viewPayload); 
    const vOut        = getOutputObject(firstView.json);
    const job         = pickFirstJob(vOut);
    
    if (!job) return respond(404, { error: `Job ${jobId} niet gevonden` });

    // 2) Vendor-context bepalen
    const vendorEmail    = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
    // 🚀 FIX: Haal Vendor ID direct uit de job (nu dit wel wordt geretourneerd door de Workflow)
    let vendorId         = String(job?.Vendor?.Id || job?.VendorId || "").trim();

    // Optionele fallback: Probeer Vendor ID via OData als de VIEW call faalt (wat nu onwaarschijnlijk is)
    if (!vendorId) {
        try { 
            // Gebruikt nu de correcte 'cfg' (was de eerdere fix)
            vendorId = await fetchJobVendorId(cfg, jobId); 
        } catch {}
    }

    console.log(`[jobsvendor][DEBUG] Uiteindelijke VendorID uit data: ${vendorId || 'NOT FOUND'}`);

    // 🚫 harde regel: vendorId verplicht voor POST
    if (!vendorId) {
        console.warn("[jobsvendor][AUTH] deny: AUTH_NO_VENDOR", { jobId, email });
        return respond(403, { error: "Geen leverancier gekoppeld aan deze job.", reason: "AUTH_NO_VENDOR" });
    }

    console.info("[jobsvendor][AUTH]", {
        jobId, email, vendorId, vendorEmail,
        hasVendorEmail: !!vendorEmail, isAtalianMail: isAtalian, action
    });

    // 3) Autorisatie
    let allowed = false;

    // ✅ Atalian-vendor override (De 'if' blijft, maar is nu gebaseerd op de API data: vendorId = '000016')
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

    // 4) Actie uitvoeren (ADD_INFO / ADD_DOC)
    if (action === "ADD_JOB_DOC") {
        const fileName    = String(body.fileName || "").trim();
        const base64      = String(body.base64   || "");
        const description = String(body.description || fileName || "Bijlage");

        if (!fileName || !base64) {
          return respond(400, { error: "Ontbrekende 'fileName' of 'base64'." });
        }
        
        // ⚠ Limiet check: Netlify limiet is 6MB (dus ongeveer 4.5MB bestand)
        if (base64.length > 6_000_000) { 
          return respond(413, { error: "Bestand te groot voor upload via functie (limiet ~4.5MB bestand)." });
        }

        const addDocPayload = {
          JobId: String(jobId),
          Action: "ADD_JOB_DOC",
          Email: email,
          AddDoc_FileName: fileName,
          AddDoc_Base64: base64,
          AddDoc_Description: description
        };

        const rAdd = await callUltimo(cfg, addDocPayload);
        const out  = getOutputObject(rAdd.json);
        return respond(200, { ok: true, jobId, action, result: out });
    }

    if (action === "ADD_INFO" || action === "CLOSE") {
        const text = String(body.text || "");
        const ultPayload =
          action === "ADD_INFO"
            ? { JobId: String(jobId), Action: "ADD_INFO", Email: email, Text: text }
            : { JobId: String(jobId), Action: "CLOSE",    Email: email, Text: text };

        const r = await callUltimo(cfg, ultPayload);
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

      // 🚀 FIX: Geef 'cfg' door aan alle GET-handlers
      if (action === "GET_JOB_DOC")  return handleGetJobDoc(cfg, params);
      if (action === "LIST_JOB_DOCS") return handleListJobDocs(cfg, params);
      if (typeof controle !== "undefined") return handleGetDomainCheck(cfg, params);

      // Default: VIEW
      return handleDefaultView(cfg, params);
    }

	/* ───────────── POST ───────────── */
	if (event.httpMethod === "POST") {
		const body = JSON.parse(event.body || "{}");
        // 🚀 FIX: handlePostAction nu opgeroepen met 'cfg'
		return handlePostAction(event, body, cfg);
	}

    return respond(405, { error: "Methode niet toegestaan." });

  } catch (err) {
    console.error("jobsvendor error", err);
    return respond(500, { error: err.message });
  }
}