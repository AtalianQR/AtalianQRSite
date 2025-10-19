// netlify/functions/melding.js
const API_KEY  = process.env.ULTIMO_API_KEY;              // per context ingevuld
const BASE_URL = process.env.ULTIMO_API_BASEURL;          // bv. https://atalian.ultimo.net/api/v1  (prod)
// in Deploy Previews zet je hier de TEST-waarde
const APP_ONE  = process.env.APP_ELEMENT_OneAtalianJob;   // ApplicationElementId

const json = (status, obj) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ApplicationElementId, ApiKey'
  },
  body: JSON.stringify(obj)
});

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // Veilige parse
  let data;
  try { data = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Body is geen geldige JSON.' }); }

  const id         = String(data.id || '').trim();
  const type       = String(data.type || '').trim();     // 'sp' | 'eq'
  const JobDescr   = String(data.JobDescr || '').trim();
  const ReportText = String(data.ReportText || '').trim();
  const lang       = (data.lang === 'fr' ? 'fr' : 'nl'); // optioneel

  // Validatie
  if (!id || !type || !JobDescr || !ReportText) {
    return json(400, { error: 'Vereist: id, type, JobDescr, ReportText.' });
  }
  if (type !== 'sp' && type !== 'eq') {
    return json(400, { error: "type moet 'sp' (Space) of 'eq' (Equipment) zijn." });
  }

  // Payload opbouwen
  const payload = { JobDescr, ReportText };
  if (type === 'sp') payload.SpaceId = id;
  if (type === 'eq') payload.EquipmentId = id;

  // Actie-endpoint (zelfde padnaam in prod & test)
  const actionUrl = `${BASE_URL}/action/_REST_OneAtalianJob`;

  try {
    const res = await fetch(actionUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        ApiKey: API_KEY,
        ApplicationElementId: APP_ONE
      },
      body: JSON.stringify(payload)
    });

    // Ultimo kan 200/201/204 teruggeven; lees tekst/JSON defensief
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (!res.ok) {
      return json(res.status, { error: 'Fout bij aanmaken melding.', detail: body });
    }

    return json(200, {
      ok: true,
      result: body,
      context: process.env.CONTEXT // 'production' | 'deploy-preview' | 'branch-deploy' (debug)
    });

  } catch (e) {
    return json(500, { error: 'Serverfout bij doorsturen naar Ultimo.', detail: String(e?.message || e) });
  }
}
