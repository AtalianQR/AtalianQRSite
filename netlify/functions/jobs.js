// netlify/functions/jobs.js
/* eslint-disable */

// === ENV =========================================================
const API_KEY         = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD   = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST   = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL; // fallback
const APP_ELEMENT     = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION   = "_rest_QueryAtalianJobs";

// === CORS / Response helper ======================================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, ApplicationElementId, ApiKey',
};

const respond = (status, obj) => ({
  statusCode: status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

// === Env-detectie (QS of host), identiek aan jobsvendor.js =======
function detectEnvironment(event = {}) {
  const qs   = event.queryStringParameters || {};
  const host = event.headers?.host || '';

  const testViaParam = qs.test === '1' || qs.test === 'true' || qs.env === 'test';
  const testViaHost  = /test|staging/i.test(host);
  const isTest = !!(testViaParam || testViaHost);
  const base   = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  const env    = isTest ? 'TEST' : 'PROD';

  if (!base) throw new Error('BASE_URL niet gezet voor geselecteerde omgeving.');
  return { base, env, isTest };
}

// === Utils =======================================================
const stripHtmlTags = (txt = "") =>
  String(txt)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

// Output.object veilig parsen (kan &quot; bevatten + control chars)
function safeParseOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (s == null) return { error: "Ultimo Output.object ontbreekt" };

  const normalized =
    typeof s === "string" ? s.replace(/&quot;/g, '"') : JSON.stringify(s);

  const cleaned = normalized
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/\u2028|\u2029/g, ' ')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  try {
    return { obj: JSON.parse(cleaned), preview: cleaned.slice(0, 800) };
  } catch (e) {
    return {
      error: `Malformed JSON from Ultimo Output.object`,
      details: String(e),
      preview: cleaned.slice(0, 800)
    };
  }
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return '';
}

function normalizeKwisId(v) {
  return firstNonEmpty(v).replace(/^0+(\d+)$/, '$1').padStart(3, '0');
}

function getJobKwisId(job = {}) {
  // Defensief: meerdere mogelijke paden opvangen
  const raw = firstNonEmpty(
    job?.Kwis?.Id,
    job?.Kwis?.ID,
    job?.Kwis?.Code,
    job?.KwisId,
    job?.KwisID,
    job?.KWISID,
    job?.KWISId,
    job?.Kwis
  );

  return normalizeKwisId(raw);
}

function isComplaintJob(job = {}) {
  return getJobKwisId(job) === '002';
}

function buildDisplayDescription(job = {}, isComplaint = false) {
  if (isComplaint) {
    return 'Er werd al een klacht geregistreerd voor deze ruimte';
  }

  return firstNonEmpty(job?.Description, job?.JobDescr, 'Openstaande melding');
}

function buildDisplayDescriptionFr(job = {}, isComplaint = false) {
  if (isComplaint) {
    return 'Une plainte a déjà été enregistrée pour cet espace';
  }

  return firstNonEmpty(job?.Description, job?.JobDescr, 'Signalement en cours');
}

function enrichJobs(jobsRaw = []) {
  return jobsRaw.map((job) => {
    const kwisId = getJobKwisId(job);
    const isComplaint = kwisId === '002';

    return {
      ...job,
      KwisId: kwisId,
      IsComplaint: isComplaint,
      DisplayDescription: buildDisplayDescription(job, isComplaint),
      DisplayDescriptionFr: buildDisplayDescriptionFr(job, isComplaint),
    };
  });
}

// === Handler =====================================================
export async function handler(event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') return respond(204, {});

  // Sanity
  if (!API_KEY || !BASE_URL_PROD || !APP_ELEMENT) {
    return respond(500, {
      error: 'Serverconfig onvolledig (API_KEY/BASE_URL_PROD/APP_ELEMENT).'
    });
  }

  try {
    const { base, env } = detectEnvironment(event);

    // ── 1. Query-params ────────────────────────────────────────────
    const { type, id, code } = event.queryStringParameters || {};

    // ── 2. Decode-blok voor 13-cijferige QR ‘code’ ────────────────
    let finalType = type;
    let finalId   = id;

    if (code) {
      if (!/^\d{13}$/.test(code)) {
        return respond(400, { error: "Ongeldige code-parameter" });
      }

      const indicator = code.slice(-1); // '9' → equipment, '0' → space
      finalType = indicator === "9" ? "eq" : "sp";

      // oorspronkelijke 6-cijferige ID = posities 0,2,4,6,8,10
      finalId = code[0] + code[2] + code[4] + code[6] + code[8] + code[10];
    }

    // ── 3. Valideer ────────────────────────────────────────────────
    if (!finalType || !finalId) {
      return respond(400, { error: "Missing 'type' of 'id' parameter." });
    }

    // ── 4. Payload voor Ultimo-Action ──────────────────────────────
    const payload = {
      SpaceId:     finalType === "sp" ? finalId : "",
      EquipmentId: finalType === "eq" ? finalId : "",
    };

    // ── 5. Ultimo-call (action) ────────────────────────────────────
    const url = `${base}/action/${ULTIMO_ACTION}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ApiKey: API_KEY,
        ApplicationElementId: APP_ELEMENT,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return respond(response.status, {
        error: "Ultimo API error",
        status: response.status,
        details: errText.slice(0, 800),
        env
      });
    }

    // 5a. Parse Ultimo response
    const rawData = await response.json();
    const { obj, error, details, preview } = safeParseOutputObject(rawData);
    if (error) return respond(502, { error, details, preview, env });

    // 5b. Velden extraheren + jobs verrijken
    const jobsRaw     = Array.isArray(obj.Jobs) ? obj.Jobs : [];
    const jobs        = enrichJobs(jobsRaw);
    const complexSvc  = Array.isArray(obj.ComplexServiceWO) ? obj.ComplexServiceWO : [];
    const qr          = typeof obj.QRCommando === "string" ? obj.QRCommando : "";

    // Optional: EquipmentTypeQR clean-up (indien aanwezig)
    let equipmentTypeQR = null;
    if (typeof obj.EquipmentTypeQR === "string") {
      const cleaned = stripHtmlTags(obj.EquipmentTypeQR).replace(/\^/g, '"');
      try {
        equipmentTypeQR = JSON.parse(cleaned);
      } catch {
        // ignore
      }
    }

    // ── 6. Succes ──────────────────────────────────────────────────
    return respond(200, {
      type : finalType,
      id   : finalId,
      Jobs : jobs,
      ComplexServiceWO: complexSvc,
      QRCommando: qr,
      EquipmentTypeQR: equipmentTypeQR,
      hasJobs: jobs.length > 0,
      env
    });

  } catch (err) {
    return respond(500, { error: String(err?.message || err) });
  }
}