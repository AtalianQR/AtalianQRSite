// netlify/functions/content.js
// Companion content-laag (laag 3) — proxy naar de Ultimo-documenten (documentsoort "QR settings" = 35).
//
// Ultimo = master, de *.js zijn slaves. Browser stuurt enkel ?spaceId=&env=.
// Deze functie:
//   1) haalt via de WFL GET_SPACE_DOCS de bijgevoegde documenten van de Space op (base64-lijst)
//   2) decodeert elk document, parset de JSON en ROUTEERT op het veld "doel" bovenaan
//        (bv. "naamgever") — parallel met room.js dat op de feature-description routeert
//   3) merge't alles tot één content-JSON dat companion.html rendert
//
// Nog geen gebouw/complex-overerving (Fase 2 breidt dit uit); voorlopig space-niveau.
/* eslint-disable */

const ULTIMO_API_KEY   = process.env.ULTIMO_API_KEY;
const ULTIMO_BASE_PROD = process.env.ULTIMO_API_BASEURL;
const ULTIMO_BASE_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_QUERY        = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION    = '_rest_QueryAtalianJobs';
const ACTION_SPACE_DOCS = process.env.ULTIMO_ACTION_SPACE_DOCS || 'GET_SPACE_DOCS';

const json = (status, obj = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
  body: JSON.stringify(obj),
});

function detectEnvironment(event = {}) {
  const qs = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';
  const isTest =
    qs.test === '1' || qs.test === 'true' || qs.env === 'test' || /test|staging/i.test(host);
  const base = isTest ? ULTIMO_BASE_TEST : ULTIMO_BASE_PROD;
  return { isTest, base, env: isTest ? 'test' : 'prod' };
}

// De actie-laag levert JSON als string in properties.Output.object, soms tussen enkele quotes;
// "'{}'" = geen documenten.
function parseActionOutput(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  let txt = String(s).trim().replace(/^'(.*)'$/, '$1');
  if (txt.includes('&quot;')) txt = txt.replace(/&quot;/g, '"');
  if (!txt || txt === '{}') return null;
  try { return JSON.parse(txt); } catch { return null; }
}

async function fetchSpaceDocs(base, spaceId) {
  const res = await fetch(`${base}/action/${ULTIMO_ACTION}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY,
      ApplicationElementId: APP_QUERY,
    },
    body: JSON.stringify({ Action: ACTION_SPACE_DOCS, SpaceId: spaceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ultimo ${ACTION_SPACE_DOCS} fout (${res.status}): ${text.slice(0, 400)}`);
  }
  const body = await res.json().catch(() => ({}));
  const parsed = parseActionOutput(body);
  return Array.isArray(parsed?.docs) ? parsed.docs : []; // lijst base64-strings
}

// Decodeer één base64-document → JSON-object (of null bij fout).
function decodeDoc(b64) {
  try {
    const txt = Buffer.from(String(b64 || ''), 'base64').toString('utf8').trim();
    if (!txt) return null;
    return JSON.parse(txt);
  } catch { return null; }
}

// Merge: elk document draagt zijn inhoud bij (alles behalve de meta-velden doel/schema),
// geïndexeerd op "doel". Latere documenten overschrijven eerdere per doel.
function mergeDocs(docs) {
  const content = {};
  const seen = [];
  for (const raw of docs) {
    const d = decodeDoc(raw);
    if (!d || typeof d !== 'object') continue;
    const doel = String(d.doel || '').trim() || 'onbekend';
    seen.push(doel);
    // Vlakke merge: de eigen veldnamen van het document (naamgever, wifi, vestigingen, bronnen…)
    // worden rechtstreeks de content-keys. 'doel' is enkel een routing-/labelhint, geen nesting-key.
    const { doel: _d, schema: _s, ...rest } = d;
    Object.assign(content, rest);
  }
  return { content, doelen: seen };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET')    return json(405, { error: 'Method not allowed' });

  const qs = event.queryStringParameters || {};
  const spaceId = String(qs.spaceId ?? qs.id ?? '').trim();
  const debug = qs.debug === '1' || qs.debug === 'true';

  if (!spaceId) return json(400, { error: 'Geen spaceId ontvangen.' });
  if (!ULTIMO_API_KEY || !APP_QUERY || !ULTIMO_BASE_PROD) {
    return json(500, { error: 'Serverconfig onvolledig (ULTIMO_API_KEY / APP_ELEMENT_QueryAtalianJobs / ULTIMO_API_BASEURL).' });
  }

  const { base, env } = detectEnvironment(event);

  try {
    const docs = await fetchSpaceDocs(base, spaceId);
    const { content, doelen } = mergeDocs(docs);
    return json(200, {
      content,
      env,
      ...(debug ? { spaceId, aantalDocs: docs.length, doelen } : {}),
    });
  } catch (err) {
    console.error('[content] fout:', err.message);
    return json(502, { error: 'Fout bij ophalen ruimte-content.', detail: String(err?.message || err), env });
  }
}
