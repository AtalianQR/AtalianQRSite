// netlify/functions/melding.js
/* eslint-disable */

// === ENV =========================================================
const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;

const APP_ONE       = process.env.APP_ELEMENT_OneAtalianJob;
const ACTION_CREATE = process.env.ULTIMO_ACTION_CREATE_JOB || '_REST_OneAtalianJob';

// === Response helper + CORS ======================================
const json = (status, obj = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ApplicationElementId, ApiKey'
  },
  body: JSON.stringify(obj)
});

// === Omgevingsdetectie ===========================================
function detectEnvironment(event = {}) {
  const qs   = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';

  const isTest =
    qs.test === '1' ||
    qs.test === 'true' ||
    (qs.env || '').toLowerCase() === 'test' ||
    /test|staging/i.test(host);

  const base = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  const env  = isTest ? 'TEST' : 'PROD';

  if (!base) throw new Error('BASE_URL niet gezet voor geselecteerde omgeving.');
  return { base, env, isTest };
}

// === Utils =======================================================
const s = (v) => String(v ?? '').trim();

function toProvider(type) {
  const t = s(type).toLowerCase();
  if (t === 'sp' || t === 'space') return 'QRConnectSpace';
  if (t === 'eq' || t === 'equipment') return 'QRConnectEqm';
  return '';
}

function safeJsonParse(txt) {
  let t = String(txt ?? '');
  if (t.includes('&quot;')) t = t.replace(/&quot;/g, '"');

  try {
    let data = JSON.parse(t);

    // Sommige Ultimo responses steken JSON nog eens als string in "object"
    if (data && typeof data.object === 'string') {
      const inner = data.object.includes('&quot;') ? data.object.replace(/&quot;/g, '"') : data.object;
      try { data = JSON.parse(inner); } catch {}
    } else if (data && data.Output && typeof data.Output.object === 'string') {
      const inner = data.Output.object.includes('&quot;') ? data.Output.object.replace(/&quot;/g, '"') : data.Output.object;
      try { data = JSON.parse(inner); } catch {}
    }

    return data;
  } catch {
    return { _raw: t };
  }
}

function extractJobId(any) {
  if (!any) return null;

  const direct =
    any.JobId || any.jobId || any.jobid ||
    (any.Job && any.Job.Id) ||
    (any.job && any.job.Id) ||
    any.Id || any.id ||
    (any.properties && (any.properties.JobId || any.properties.jobId || any.properties.jobid)) ||
    (any.Properties && (any.Properties.JobId || any.Properties.jobId || any.Properties.jobid));

  if (direct) return String(direct);

  const raw = typeof any === 'string' ? any : (any._raw || '');
  if (raw) {
    const m =
      raw.match(/"jobid"\s*:\s*"?(\d{5,})"?/i) ||
      raw.match(/"JobId"\s*:\s*"?(\d{5,})"?/i) ||
      raw.match(/"Id"\s*:\s*"?(\d{5,})"?/);

    if (m) return m[1];
  }
  return null;
}

// --- Text sanitize ------------------------------------------------
function normalizePortalLog(reportTextIn = '', emailFromPayload = '') {
	  const raw = String(reportTextIn ?? '').replace(/\r/g, '\n');

	  // zoek velden (tolerant: pipes of nieuwe lijnen)
	  const kanaal = (raw.match(/Kanaal\s*:\s*([^|\n]+)/i)?.[1] || 'PortalSelf').trim();

	  const email =
		(raw.match(/Email\s*:\s*([^|\n]+)/i)?.[1] || emailFromPayload || '').trim();

	  // GPS kan 2 vormen hebben: lat/lon/acc of "unavailable"
	  const gpsLat = raw.match(/lat\s*=\s*([-\d.]+)/i)?.[1];
	  const gpsLon = raw.match(/lon\s*=\s*([-\d.]+)/i)?.[1];
	  const gpsAcc = raw.match(/acc\s*=\s*([-\d.]+)\s*m/i)?.[1];

	  let gpsPart = 'GPS: unavailable';
	  if (gpsLat && gpsLon) {
		const acc = gpsAcc ? `${Math.round(Number(gpsAcc))}m` : '';
		gpsPart = `GPS: lat=${gpsLat}; lon=${gpsLon}${acc ? `; acc=${acc}` : ''}`;
	  } else if (/GPS\s*:\s*unavailable/i.test(raw)) {
		gpsPart = 'GPS: unavailable';
	  }

	  const parts = [`Kanaal: ${kanaal}`];
	  if (email) parts.push(`Email: ${email}`);
	  parts.push(gpsPart);

	  return parts.join(' | ');
	}


// === Handler ======================================================
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  // Misconfig check (hard fail)
  if (!API_KEY || !BASE_URL_PROD || !APP_ONE) {
    return json(500, {
      error: 'Server misconfiguratie (env-variabelen ontbreken).',
      missing: {
        ULTIMO_API_KEY: !API_KEY,
        ULTIMO_API_BASEURL: !BASE_URL_PROD,
        APP_ELEMENT_OneAtalianJob: !APP_ONE
      }
    });
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Body is geen geldige JSON.' }); }

  let base, env;
  try {
    ({ base, env } = detectEnvironment(event));
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }

  // ===== Inputs (CREATE only) =====
  const id       = s(data.id);
  const type     = s(data.type);             // 'sp' of 'eq'
  const JobDescr = s(data.JobDescr);
  const Email    = s(data.Email);
  const ServiceWOId  = s(data.ServiceWOId);
  const ReportTextIn = typeof data.ReportText === 'string' ? data.ReportText : '';

  if (!id || !type || !JobDescr) {
    return json(400, { error: 'Vereist: id, type, JobDescr.' });
  }
  if (type !== 'sp' && type !== 'eq') {
    return json(400, { error: "type moet 'sp' (Space) of 'eq' (Equipment) zijn." });
  }

  const Provider = toProvider(type);
  if (!Provider) return json(400, { error: 'Kon Provider niet bepalen uit type.' });

  const ReportText = normalizePortalLog(ReportTextIn, Email);

  // ExternalId enkel voor CREATE (dedupe / tracing)
  const ExternalId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 48);

  const actionUrl = `${base}/action/${ACTION_CREATE}`;

  const wfPayload = {
    JobDescr,
    Provider,
    ReportText,
    ExternalId,
  };

  // Optional fields
  if (Email) wfPayload.Email = Email;
  if (ServiceWOId) wfPayload.ServiceWOId = ServiceWOId;

  if (type === 'sp') wfPayload.SpaceId = `QR:${id}`;
  if (type === 'eq') wfPayload.EquipmentId = id;

  try {
    const res = await fetch(actionUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        ApiKey: API_KEY,
        ApplicationElementId: APP_ONE
      },
      body: JSON.stringify(wfPayload)
    });

    const text = await res.text();
    const body = safeJsonParse(text);

    if (!res.ok) {
      return json(res.status, {
        ok: false,
        env,
        error: 'Fout bij aanmaken melding.',
        detail: body,
        preview: typeof text === 'string' ? text.slice(0, 900) : undefined,
        sent: {
          actionUrl,
          app: APP_ONE,
          type,
          hasEmail: !!Email,
          hasServiceWO: !!ServiceWOId,
          externalId: ExternalId
        }
      });
    }

    const jobId = extractJobId(body);
    if (!jobId) {
      return json(502, {
        ok: false,
        env,
        error: 'Ultimo gaf geen JobId terug (mogelijk abort/validatiefout).',
        msgOut: body?.msgOut || body?.Message || body?._raw || null,
        preview: typeof text === 'string' ? text.slice(0, 900) : undefined,
        sent: {
          actionUrl,
          app: APP_ONE,
          type,
          externalId: ExternalId
        }
      });
    }

    return json(200, { ok: true, env, jobId, externalId: ExternalId, result: body });

  } catch (e) {
    return json(502, {
      ok: false,
      env,
      error: 'Ultimo-call failed (create)',
      detail: String(e?.message || e)
    });
  }
}
