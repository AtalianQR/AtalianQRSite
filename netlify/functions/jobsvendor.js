// === netlify/functions/jobsvendor.js (Met VendorId 000016 override + melder-fix + StatusText support + VENDOR_COMPLAINT_FIELDS) ===

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


// ✅ Nieuw: StatusText stempel (voor ProgressStatusHistory.RemarkText)
function buildStatusTextStamp({ email, channel = "PortalSelf", gps }) {
  const parts = [`Kanaal: ${channel}`];

  if (String(email || "").trim()) {
    parts.push(`Email: ${String(email).trim()}`);
  }

  // gps = { ok:boolean, lat, lon, acc }
  if (gps?.ok && typeof gps.lat === "number" && typeof gps.lon === "number") {
    const acc = (gps.acc != null) ? `${Math.round(gps.acc)}m` : "?m";
    parts.push(`GPS: lat=${gps.lat}; lon=${gps.lon}; acc=${acc}`);
  } else if (gps) {
    parts.push(`GPS: unavailable`);
  }

  return parts.join(" | ");
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
async function fetchJobVendorId(cfg, jobId) {
  const url = `${cfg.base}/object/Job('${String(jobId)}')`;
  const res = await fetch(url, { headers: { accept: 'application/json', ApiKey: cfg.key } });
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  const v = data?.Vendor?.Id || data?.properties?.Vendor?.Id || data?.Vendor || data?.properties?.Vendor || '';
  return String((typeof v === 'object' ? v?.Id : v) || '').trim();
}

/* ───────────── GET HANDLERS ───────────── */

function isTestRequested(event) {
  const qs = event.queryStringParameters || {};
  const hdr = event.headers || {};
  const h = (k) => String(hdr[k] || hdr[k?.toLowerCase()] || "").toLowerCase();
  const ref = h("referer");   // volledige pagina-URL
  const org = h("origin");    // bv. http://localhost:8888
  const xenv = h("x-atalian-env"); // expliciete override vanuit frontend

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
  const host = event.headers?.host || "";

  const prod = {
    base: process.env.ULTIMO_API_BASEURL,
    key: process.env.ULTIMO_API_KEY,
    app: process.env.APP_ELEMENT_QueryAtalianJobs,
    name: "PROD",
  };

  const test = {
    base: process.env.ULTIMO_API_BASEURL_TEST, // geen fallback naar PROD!
    key: process.env.ULTIMO_API_KEY_TEST || process.env.ULTIMO_API_KEY,
    app: process.env.APP_ELEMENT_QueryAtalianJobs_TEST || process.env.APP_ELEMENT_QueryAtalianJobs,
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

async function handleGetJobDoc(cfg, { docId }) {
  if (!docId || !/^\d+$/.test(docId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'docId'." });
  }
  const r = await callUltimo(cfg, { Action: "GET_JOB_DOC", objdocid: String(docId) });
  const out = getOutputObject(r.json);
  return respond(200, { docId: String(docId), Document: out });
}

async function handleListJobDocs(cfg, { jobId }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }
  const r = await callUltimo(cfg, { Action: "LIST_JOB_DOCS", JobId: String(jobId) });
  const out = getOutputObject(r.json);
  const docs = pickDocuments(out);
  return respond(200, { jobId: String(jobId), Documents: docs });
}

// === Login/domain check (met VendorId-override) ===
async function handleGetDomainCheck(cfg, { jobId, email, hasEmail }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }

  const viewPayload = { JobId: String(jobId), Action: "VIEW" };
  if (hasEmail) viewPayload.Email = email.trim();

  const view = await callUltimo(cfg, viewPayload);
  const vOut = getOutputObject(view.json);
  const job = pickFirstJob(vOut);

  if (!job) {
    return respond(200, { allowed: false, reason: "Job niet gevonden." });
  }

  const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
  const isAtalianEmail = hasEmail && emailDomain(email) === 'atalianworld.com';
  const vendorId = String(job?.Vendor?.Id || job?.VendorId || "").trim();
  const hasVendor = isNonEmpty(vendorEmail);

  // Override: Atalian vendor 000016
  if (isAtalianEmail && vendorId === '000016') {
    console.log("[auth] allow: Atalian vendor + Atalian mail (GET bypass)");
    return respond(200, { allowed: true, override: 'vendor000016' });
  }

  if (!hasEmail || (!hasVendor && !isAtalianEmail)) {
    const reason = !hasEmail
      ? "E-mail ontbreekt"
      : "Job heeft geen gekoppelde leverancier.";
    return respond(200, { allowed: false, reason });
  }

  const payload = {
    JobId: String(jobId),
    Email: email.trim(),
    Controle: email.trim(),
    ControleDomain: getDomain(email),
    LoginDomain: getDomain(email),
    VendorDomain: getDomain(vendorEmail),
    Action: "VIEW",
  };
  const chk = await callUltimo(cfg, payload);
  const out = getOutputObject(chk.json);
  const allowed = String(out).toLowerCase() === "true";
  return respond(200, { allowed });
}

// ======================================================================

async function handleDefaultView(cfg, { jobId, email, action, hasEmail }) {
  if (!isValidJobId(jobId)) {
    return respond(400, { error: "Ongeldig of ontbrekend 'jobId'." });
  }
  const viewPayload = { JobId: String(jobId), Action: action };
  if (hasEmail) viewPayload.Email = email.trim();

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

/* ───────────── POST HANDLER ───────────── */

async function handlePostAction(event, body, cfg) {
  const qs = event.queryStringParameters || {};
  const action = String(qs.action || body.action || "").trim().toUpperCase(); // ✅ normalize
  const jobId = String(qs.jobId || body.jobId || "").trim();
  const email = String(body.email || qs.email || "").trim();
  const channel = String(body.channel || body.Channel || "PortalSelf").trim();

	const gps = {
	  ok: body.gpsOk === true || body.gpsOk === "true",
	  lat: (typeof body.gpsLat === "number") ? body.gpsLat : null,
	  lon: (typeof body.gpsLon === "number") ? body.gpsLon : null,
	  acc: (typeof body.gpsAcc === "number") ? body.gpsAcc : null
	};

  if (!action) return respond(400, { error: "action ontbreekt" });
  if (!jobId) return respond(400, { error: "jobId ontbreekt" });
  if (!email) return respond(400, { error: "email ontbreekt" });

  const isAtalian = getDomain(email) === "atalianworld.com";
  const isDocAction = action === "ADD_JOB_DOC";

  // 1) Job ophalen via VIEW (workflow geeft VendorId & VendorEmailAddress)
  const viewPayload = { JobId: String(jobId), Action: "VIEW", Email: email };
  const firstView = await callUltimo(cfg, viewPayload);
  const vOut = getOutputObject(firstView.json);
  const job = pickFirstJob(vOut);

  if (!job) return respond(404, { error: `Job ${jobId} niet gevonden` });

	// 2) Vendor-context
	const vendorEmail = job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";
	let vendorId = String(job?.Vendor?.Id || job?.VendorId || "").trim();

	// ✅ fallback: LoopVendorId uit job en/of body (bij refresh kan VendorId ontbreken)
	const loopVendorIdFromJob  = String(job?.LoopVendorId || "").trim();
	const loopVendorIdFromBody = String(body?.loopVendorId || body?.LoopVendorId || "").trim();

	if (!vendorId) {
	  try {
		vendorId = await fetchJobVendorId(cfg, jobId);
	  } catch {}
	}

	// ✅ laatste redmiddel: LoopVendorId gebruiken als vendorId
	if (!vendorId) {
	  vendorId = loopVendorIdFromBody || loopVendorIdFromJob || "";
	}

	console.log(`[jobsvendor][DEBUG] Uiteindelijke VendorID uit data: ${vendorId || 'NOT FOUND'}`); 


  // 3) Autorisatie
  let allowed = false;

  if (!vendorId) {
    // Geen vendor gekoppeld → melder-scenario → doc-upload altijd toestaan
    if (isDocAction) {
      allowed = true;
      console.warn("[jobsvendor][AUTH] no vendorId → treating as melder upload, allowing ADD_JOB_DOC", { jobId, email });
    } else {
      console.warn("[jobsvendor][AUTH] deny: AUTH_NO_VENDOR (non-doc action)", { jobId, email });
      return respond(403, { error: "Geen leverancier gekoppeld aan deze job.", reason: "AUTH_NO_VENDOR" });
    }
  } else {
    console.info("[jobsvendor][AUTH]", {
      jobId, email, vendorId, vendorEmail,
      hasVendorEmail: !!vendorEmail, isAtalianMail: isAtalian, action
    });

    if (vendorId === "000016" && isAtalian) {
      allowed = true;
      console.info("[auth] allow: Atalian vendor + Atalian mail");
    } else if (vendorEmail) {
      const loginDom = getDomain(email);
      const vendorDom = getDomain(vendorEmail);
      allowed = !!loginDom && !!vendorDom && loginDom === vendorDom;
      console.info("[auth] domain-check", { loginDom, vendorDom, allowed });
    } else {
      console.warn("[auth] deny: no vendor email for non-Atalian vendor");
      allowed = false;
    }
  }

  if (!allowed) {
    return respond(403, { error: "E-mailadres niet toegestaan voor deze job/leverancier." });
  }

  // 4) Actie uitvoeren
  if (isDocAction) {
    const fileName = String(body.fileName || "").trim();
    const base64 = String(body.base64 || "");
    const description = String(body.description || fileName || "Bijlage");

    if (!fileName || !base64) {
      return respond(400, { error: "Ontbrekende 'fileName' of 'base64'." });
    }

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
    const out = getOutputObject(rAdd.json);
    return respond(200, { ok: true, jobId, action, result: out });
  }

  // VENDOR_COMPLAINT_FIELDS ondersteunen
  if (action === "VENDOR_COMPLAINT_FIELDS") {
    // Support zowel PascalCase (frontend) als camelCase (fallback)
    const rootCause =
      String(body.RootCause || body.rootCause || body.CPLRoot || body._CPLRoot || "").trim();
    const correction =
      String(body.Correction || body.correction || body.CPLCorrection || body._CPLCorrection || "").trim();
    const correctiveMeasure =
      String(body.CorrectiveMeasure || body.correctiveMeasure || body.CPLCorMeasure || body._CPLCorMeasure || "").trim();
    const effectiveness =
      String(body.Effectiveness || body.effectiveness || body.CPLEffectiveness || body._CPLEffectiveness || "").trim();

    if (!rootCause || !correction || !correctiveMeasure || !effectiveness) {
      return respond(400, {
        error: "Ontbrekende velden voor VENDOR_COMPLAINT_FIELDS",
        missing: {
          rootCause: !rootCause,
          correction: !correction,
          correctiveMeasure: !correctiveMeasure,
          effectiveness: !effectiveness
        }
      });
    }

    const ultPayload = {
      JobId: String(jobId),
      Action: "VENDOR_COMPLAINT_FIELDS",
      Email: email,

      // ⚠️ Deze keys moeten matchen met je Ultimo workflow
      RootCause: rootCause,
      Correction: correction,
      CorrectiveMeasure: correctiveMeasure,
      Effectiveness: effectiveness,

      // ✅ audit trail
      StatusText: buildStatusTextStamp({ email, channel, gps })
    };

    console.log("[jobsvendor] WF PAYLOAD (VENDOR_COMPLAINT_FIELDS) =>", JSON.stringify({
      ...ultPayload,
      RootCause: rootCause ? "[set]" : "",
      Correction: correction ? "[set]" : "",
      CorrectiveMeasure: correctiveMeasure ? "[set]" : "",
      Effectiveness: effectiveness ? "[set]" : ""
    }));

    const r = await callUltimo(cfg, ultPayload);
    const out = getOutputObject(r.json);
    return respond(200, { ok: true, jobId, action, result: out });
  }

  // VENDOR_COMPLAINT_FINISH (finalize: velden + status + mails via Ultimo WF)
  if (action === "VENDOR_COMPLAINT_FINISH") {
    // Support zowel PascalCase (frontend) als camelCase (fallback)
    const rootCause =
      String(body.RootCause || body.rootCause || body.CPLRoot || body._CPLRoot || "").trim();
    const correction =
      String(body.Correction || body.correction || body.CPLCorrection || body._CPLCorrection || "").trim();
    const correctiveMeasure =
      String(body.CorrectiveMeasure || body.correctiveMeasure || body.CPLCorMeasure || body._CPLCorMeasure || "").trim();
    const effectiveness =
      String(body.Effectiveness || body.effectiveness || body.CPLEffectiveness || body._CPLEffectiveness || "").trim();

    if (!rootCause || !correction || !correctiveMeasure || !effectiveness) {
      return respond(400, {
        error: "Ontbrekende velden voor VENDOR_COMPLAINT_FINISH",
        missing: {
          rootCause: !rootCause,
          correction: !correction,
          correctiveMeasure: !correctiveMeasure,
          effectiveness: !effectiveness
        }
      });
    }

    // ✅ enkel voor KWIS 002
    const kwis = getKwisId(job);
    if (kwis !== "002") {
      console.warn("[jobsvendor] VENDOR_COMPLAINT_FINISH blocked: not a complaint job", { jobId, kwis, action });
      return respond(403, { error: "Deze actie is enkel toegestaan voor KWIS 002.", kwis });
    }

    // Optioneel: extra tekst/nota (mag leeg zijn)
    const text = String(body.text || body.Text || "").trim();

    const ultPayload = {
      JobId: String(jobId),
      Action: "VENDOR_COMPLAINT_FINISH",
      Email: email,

      // ⚠️ Deze keys moeten matchen met je Ultimo workflow
      RootCause: rootCause,
      Correction: correction,
      CorrectiveMeasure: correctiveMeasure,
      Effectiveness: effectiveness,

      // optioneel
      Text: text,

      // ✅ audit trail
      StatusText: buildStatusTextStamp({ action: "VENDOR_COMPLAINT_FINISH", email })
    };

    console.log("[jobsvendor] WF PAYLOAD (VENDOR_COMPLAINT_FINISH) =>", JSON.stringify({
      ...ultPayload,
      RootCause: rootCause ? "[set]" : "",
      Correction: correction ? "[set]" : "",
      CorrectiveMeasure: correctiveMeasure ? "[set]" : "",
      Effectiveness: effectiveness ? "[set]" : "",
      Text: text ? "[set]" : ""
    }));

    const r = await callUltimo(cfg, ultPayload);
    const out = getOutputObject(r.json);
    return respond(200, { ok: true, jobId, action, result: out });
  }
  
  
 // helper (zet dit bv bovenaan bij je andere helpers)
	function getKwisId(job){
	  return String(
		job?.Kwis?.Id ??
		job?.KwisId ??
		job?.Kwis ??
		job?.Kwis?.id ??
		''
	  ).trim();
	}

	// ✅ Nieuw: JOB_PROGRESSSTATUS_NOI ondersteunen (bv. verkeerd toegewezen = 1001)
	if (action === "JOB_PROGRESSSTATUS_NOI") {
	  const newPsId = String(body.newProgressStatusId || body.NewProgressStatusId || body.NewProgressStatus || "").trim();

	  if (!/^\d+$/.test(newPsId)) {
		return respond(400, { error: "newProgressStatusId ontbreekt of is ongeldig." });
	  }

	  const kwis = getKwisId(job);
	  if (kwis !== "002") {
		console.warn("[jobsvendor] JOB_PROGRESSSTATUS_NOI blocked: not a complaint job", { jobId, kwis, action });
		return respond(403, { error: "Deze actie is enkel toegestaan voor KWIS 002.", kwis });
	  }

	  const ultPayload = {
		JobId: String(jobId),
		Action: "JOB_PROGRESSSTATUS_NOI",
		Email: email,
		NewProgressStatusId: newPsId,
		StatusText: buildStatusTextStamp({ email, channel, gps })
	  };

	  console.log("[jobsvendor] WF PAYLOAD (JOB_PROGRESSSTATUS_NOI) =>", JSON.stringify(ultPayload));

	  const r = await callUltimo(cfg, ultPayload);
	  const out = getOutputObject(r.json);
	  return respond(200, { ok: true, jobId, action: "JOB_PROGRESSSTATUS_NOI", result: out });
	}

 

  // ✅ Nieuw: ACTIVATE_VENDORJOB ook ondersteunen + StatusText meesturen
	if (action === "ADD_INFO" || action === "CLOSE" || action === "ACTIVATE_VENDORJOB") {
	  const text = String(body.text || "");

	  // ✅ text enkel verplicht voor ADD_INFO en CLOSE (niet voor ACTIVATE_VENDORJOB)
	  if (!text && (action === "ADD_INFO" || action === "CLOSE")) {
		return respond(400, { error: "text ontbreekt" });
	  }

    const ultPayload = {
      JobId: String(jobId),
      Action: action,
      Email: email,
      Text: text,
      StatusText: buildStatusTextStamp({ email, channel, gps }) // ✅ dit was de missing link
    };

    console.log("[jobsvendor] WF PAYLOAD =>", JSON.stringify(ultPayload));

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

    const cfg = buildEnvConfig(event);
    console.log(`[jobsvendor] 🔎 Handler start in ${cfg.name} → base=${cfg.base}`);

    /* ───────────── GET ───────────── */
    if (event.httpMethod === "GET") {
      const { jobId, email = "", action = "VIEW", controle, docId } = event.queryStringParameters || {};
      const hasEmail = isNonEmpty(email);
      const params = { jobId, email, action, controle, docId, hasEmail };

      if (action === "GET_JOB_DOC") return handleGetJobDoc(cfg, params);
      if (action === "LIST_JOB_DOCS") return handleListJobDocs(cfg, params);
      if (typeof controle !== "undefined") return handleGetDomainCheck(cfg, params);

      return handleDefaultView(cfg, params);
    }

    /* ───────────── POST ───────────── */
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      return handlePostAction(event, body, cfg);
    }

    return respond(405, { error: "Methode niet toegestaan." });

  } catch (err) {
    console.error("jobsvendor error", err);
    return respond(500, { error: err.message });
  }
}
