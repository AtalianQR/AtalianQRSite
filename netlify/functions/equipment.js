// netlify/functions/equipment.js
/* eslint-disable */

// === ENV =========================================================
const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_QUERY     = process.env.APP_ELEMENT_QueryAtalianJobs;

// === Response helper + CORS ======================================
const json = (status, obj = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ApplicationElementId, ApiKey'
  },
  body: JSON.stringify(obj)
});

// === Omgevingsdetectie (QS of host) ===============================
function detectEnvironment(event = {}) {
  const qs   = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';

  const testViaParam =
    qs.test === '1' || qs.test === 'true' ||
    qs.env  === 'test'; // ← compatibel met portal.html (&env=test)
  const testViaHost  = /test|staging/i.test(host);

  const isTest = !!(testViaParam || testViaHost);
  const base   = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  const env    = isTest ? 'TEST' : 'PROD';

  if (!base) {
    // Minimale sanity check om verkeerde deploy-config snel te zien
    throw new Error('BASE_URL niet gezet voor geselecteerde omgeving.');
  }
  return { isTest, base, env };
}

// === Handler =====================================================
export async function handler(event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  try {
    if (!API_KEY || !BASE_URL_PROD) {
      return json(500, { description: '', error: 'Server misconfiguratie (env-variabelen ontbreken).' });
    }

    // Params
    const equipmentId = String(event.queryStringParameters?.id ?? '').trim();
    const langRaw = String(event.queryStringParameters?.lang ?? '').toLowerCase();
    const lang = langRaw === 'fr' ? 'fr' : 'nl'; // future-proof: toonbare teksten
    if (!equipmentId) return json(400, { description: '', error: 'Geen geldig ID ontvangen.' });

    // Env
    const { base, env } = detectEnvironment(event);

    if (!APP_QUERY) {
      return json(500, { description: '', error: 'Server misconfiguratie (APP_ELEMENT_QueryAtalianJobs ontbreekt).' });
    }

    // Installatie-info volledig via de actie-laag (GET_EQUIPMENT_INFO) - geen directe object-laag-call
    // meer op /object/Equipment, zodat deze toegang individueel beheerbaar/afzetbaar blijft in Ultimo.
    const wfRes = await fetch(`${base}/action/_rest_QueryAtalianJobs`, {
      method: 'POST',
      headers: { accept: 'application/json', 'Content-Type': 'application/json', ApiKey: API_KEY, ApplicationElementId: APP_QUERY },
      body: JSON.stringify({ Action: 'GET_EQUIPMENT_INFO', EquipmentId: equipmentId })
    });

    if (!wfRes.ok) {
      const txt = await wfRes.text().catch(() => '');
      return json(wfRes.status, {
        description: '',
        error: (lang === 'fr') ? 'Erreur lors du chargement de l’installation.' : 'Fout bij ophalen van installatie.',
        detail: txt.slice(0, 800),
        env
      });
    }

    const wfRaw = await wfRes.json().catch(() => ({}));
    const objStr = wfRaw?.properties?.Output?.object ?? wfRaw?.object ?? null;
    const trimmed = objStr ? String(objStr).trim().replace(/^'(.*)'$/, '$1') : '';
    const obj = trimmed && trimmed !== '{}' ? JSON.parse(trimmed) : null;

    if (!obj) {
      return json(404, {
        description: '',
        error: (lang === 'fr')
          ? `Installation avec ID ${equipmentId} introuvable.`
          : `Installatie met ID ${equipmentId} niet gevonden.`,
        env
      });
    }

    const desc =
      String(obj?.description ?? '').trim() ||
      ((lang === 'fr') ? 'Aucune description trouvée.' : 'Geen beschrijving gevonden.');
    const clientName = String(obj?.clientName ?? '').trim();
    const clientId   = String(obj?.clientId   ?? '').trim();

    return json(200, {
      description: desc,
      clientName,
      clientId,
      env
    });

  } catch (err) {
    return json(500, {
      description: '',
      error: 'Serverfout bij ophalen.',
      detail: String(err?.message || err)
    });
  }
}
