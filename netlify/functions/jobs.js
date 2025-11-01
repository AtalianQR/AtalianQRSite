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
const respond = (status, obj) => ({ statusCode: status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

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
  String(txt).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();

// Output.object veilig parsen (kan &quot; bevatten + control chars)
function safeParseOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (s == null) return { error: "Ultimo Output.object ontbreekt" };

  const normalized = typeof s === "string" ? s.replace(/&quot;/g, '"') : JSON.stringify(s);
  const cleaned = normalized
    .replace(/[\u0000-\u001F]+/g, ' ')  // NUL..US incl. \n \r \t → spatie
    .replace(/\u2028|\u2029/g, ' ')     // Unicode line/para sep
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  try {
    return { obj: JSON.parse(cleaned), preview: cleaned.slice(0, 800) };
  } catch (e) {
    return { error: `Malformed JSON from Ultimo Output.object`, details: String(e), preview: cleaned.slice(0, 800) };
  }
}

// === Handler =====================================================
export async function handler(event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') return respond(204, {});

  // Sanity
  if (!API_KEY || !BASE_URL_PROD || !APP_ELEMENT) {
    return respond(500, { error: 'Serverconfig onvolledig (API_KEY/BASE_URL_PROD/APP_ELEMENT).' });
  }

  try {
    const { base, env } = detectEnvironment(event); // ⇐ TEST/PROD switch

    // ── 1. Query-params ────────────────────────────────────────────
    const { type, id, code } = event.queryStringParameters || {};

    // ── 2. Decode-blok voor 13-cijferige QR ‘code’ ────────────────
    let finalType = type;
    let finalId   = id;

    if (code) {
      if (!/^\d{13}$/.test(code)) {
        return respond(400, { error: "Ongeldige code-parameter" });
      }
      const indicator = code.slice(-1);                // '9' → equipment, '0' → space
      finalType       = indicator === "9" ? "eq" : "sp";
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
      return respond(response.status, { error: "Ultimo API error", status: response.status, details: errText.slice(0, 800), env });
    }

    // 5a. Parse Ultimo response
    const rawData = await response.json();
    const { obj, error, details, preview } = safeParseOutputObject(rawData);
    if (error) return respond(502, { error, details, preview, env });

    // 5b. Velden extraheren
    const jobs        = Array.isArray(obj.Jobs) ? obj.Jobs : [];
    const complexSvc  = Array.isArray(obj.ComplexServiceWO) ? obj.ComplexServiceWO : [];
    const qr          = typeof obj.QRCommando === "string" ? obj.QRCommando : "";

    // Optional: EquipmentTypeQR clean-up (indien aanwezig)
    let equipmentTypeQR = null;
    if (typeof obj.EquipmentTypeQR === "string") {
      const cleaned = stripHtmlTags(obj.EquipmentTypeQR).replace(/\^/g, '"');
      try { equipmentTypeQR = JSON.parse(cleaned); } catch { /* ignore */ }
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
