// netlify/functions/melding.js
/* eslint-disable */

// === ENV =========================================================
const API_KEY  = process.env.ULTIMO_API_KEY;
const BASE_URL = process.env.ULTIMO_API_BASEURL;
const APP_ONE  = process.env.APP_ELEMENT_OneAtalianJob;

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

  // 1) meest voorkomende varianten (case-varianten + genest)
  const direct =
    any.JobId || any.jobId || any.jobid ||
    (any.Job && any.Job.Id) ||
    (any.job && any.job.Id) ||
    any.Id || any.id ||
    (any.properties && (any.properties.JobId || any.properties.jobId || any.properties.jobid)) ||
    (any.Properties && (any.Properties.JobId || any.Properties.jobId || any.Properties.jobid));
  if (direct) return String(direct);

  // 2) soms zit er nog een "object" als string in het body-object zelf
  if (typeof any.object === 'string') {
    try {
      const inner = any.object.includes('&quot;') ? any.object.replace(/&quot;/g, '"') : any.object;
      const p = JSON.parse(inner);
      const id2 = extractJobId(p);
      if (id2) return id2;
    } catch {}
  }
  if (any.Output && typeof any.Output.object === 'string') {
    try {
      const inner = any.Output.object.includes('&quot;') ? any.Output.object.replace(/&quot;/g, '"') : any.Output.object;
      const p = JSON.parse(inner);
      const id3 = extractJobId(p);
      if (id3) return id3;
    } catch {}
  }

  // 3) laatste redmiddel: brute-force op het hele object (breedte-eerst)
  try {
    const queue = [any];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || typeof cur !== 'object') continue;
      for (const [k, v] of Object.entries(cur)) {
        const key = k.toLowerCase();
        if ((key === 'jobid' || (key === 'id' && String(v).length >= 5)) && (typeof v === 'string' || typeof v === 'number')) {
          return String(v);
        }
        if (v && typeof v === 'object') queue.push(v);
      }
    }
  } catch {}
  
  // 4) regex fallback op raw
  const raw = typeof any === 'string' ? any : (any._raw || '');
  if (raw) {
    const m = raw.match(/"jobid"\s*:\s*"?(\d{5,})"?/i) || raw.match(/"Id"\s*:\s*"?(\d{5,})"?/);
    if (m) return m[1];
  }

  return null;
}


function buildReportText(email, clientRT) {
  const melder = `QRCode-Melder = ${email || '-'}`;
  // ❗ Hou de leading newline van clientRT intact
  const body = typeof clientRT === 'string'
    ? clientRT.replace(/\s+$/,'') // enkel trailing spaties weg, niet de \n vooraan
    : '';

  if (!body) return melder;

  // Dubbel vermijden (als body al melder-lijn bevat)
  const norm = body.replace(/\s+/g, ' ').toLowerCase();
  if ((email && norm.includes(String(email).toLowerCase())) ||
      norm.includes('qrcode-melder')) {
    return body; // laat zoals het is
  }

  // melderlijn + newline; body start (in portal) met "\nBijlagen: ..."
  return `${melder}\n${body}`;
}



// === Handler =====================================================
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  if (!API_KEY || !BASE_URL || !APP_ONE) {
    return json(500, { error: 'Server misconfiguratie (env-variabelen ontbreken).' });
  }

  // Body
  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Body is geen geldige JSON.' }); }

  // Inkomend vanuit Portal
  const id           = s(data.id);
  const type         = s(data.type);          // 'sp' | 'eq'
  const JobDescr     = s(data.JobDescr);
  const ReportTextIn = typeof data.ReportText === 'string' ? data.ReportText : '';
  const Email        = s(data.Email);
  const ServiceWOId  = s(data.ServiceWOId);

  // Validatie
  if (!id || !type || !JobDescr) return json(400, { error: 'Vereist: id, type, JobDescr.' });
  if (type !== 'sp' && type !== 'eq') return json(400, { error: "type moet 'sp' (Space) of 'eq' (Equipment) zijn." });

  const Provider = toProvider(type);

  // ReportText = required voor WF → altijd invullen
  const ReportText = buildReportText(Email, ReportTextIn);

  // ExternalId: veilig & kort (max 48 chars, enkel a-z0-9-)
  const ExternalId = `${Date.now()}-${Math.random().toString(36).slice(2)}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);

  // Payload naar WF
  const wfPayload = {
    JobDescr,
    Provider,
    ReportText,
    ExternalId
  };
  if (Email)        wfPayload.Email        = Email;
  if (ServiceWOId)  wfPayload.ServiceWOId  = ServiceWOId;
  if (type === 'sp') wfPayload.SpaceId     = `QR:${id}`;
  if (type === 'eq') wfPayload.EquipmentId  = id;

  const actionUrl = `${BASE_URL}/action/_REST_OneAtalianJob`;

  try {
    const res  = await fetch(actionUrl, {
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

    // ❗ Nieuw: 200 maar GEEN jobId = functioneel FOUT ⇒ direct terugkoppelen
    if (!res.ok) {
      return json(res.status, {
        ok: false,
        error: 'Fout bij aanmaken melding.',
        detail: body,
        preview: typeof text === 'string' ? text.slice(0, 800) : undefined,
        sent: { // subset, geen PII
          Provider, hasEmail: !!Email, hasServiceWO: !!ServiceWOId,
          idType: type, idValueLen: id.length, externalId: ExternalId
        }
      });
    }

    const jobId = extractJobId(body);

    if (!jobId) {
      // WF kan Abort of validatiefout geven met 200 → expose msgOut/preview
      return json(502, {
        ok: false,
        error: 'Ultimo gaf geen JobId terug (mogelijk abort/validatiefout).',
        msgOut: body?.msgOut || body?.Message || body?._raw || null,
        preview: typeof text === 'string' ? text.slice(0, 800) : undefined,
        sent: {
          Provider, hasEmail: !!Email, hasServiceWO: !!ServiceWOId,
          idType: type, idValueLen: id.length, externalId: ExternalId
        }
      });
    }

    return json(200, {
      ok: true,
      jobId,
      externalId: ExternalId,
      result: body
    });

  } catch (e) {
    return json(502, {
      ok: false,
      error: 'Ultimo-call failed',
      detail: String(e?.message || e)
    });
  }
}
