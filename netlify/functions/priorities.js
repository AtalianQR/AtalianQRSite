// netlify/functions/priorities.js
/* eslint-disable */

const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT   = process.env.APP_ELEMENT_QueryAtalianJobs;

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

function detectEnvironment(event = {}) {
  const qs = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';
  const isTest = !!(qs.test === '1' || qs.test === 'true' || qs.env === 'test' || /test|staging/i.test(host));
  const base = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  if (!base) throw new Error('BASE_URL niet gezet voor geselecteerde omgeving.');
  return { isTest, base, env: isTest ? 'TEST' : 'PROD' };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  try {
    if (!API_KEY || !BASE_URL_PROD) {
      return json(500, { error: 'Server misconfiguratie (env-variabelen ontbreken).' });
    }


    let qs = event.queryStringParameters || {};
    if (!qs.spaceId && !qs.deptId && event.rawQuery) {
      const raw = new URLSearchParams(event.rawQuery);
      qs = Object.fromEntries(raw.entries());
    }

    const rawSpaceId = String(qs.spaceId ?? qs.spaceid ?? '').trim();
    // Strip single-letter prefix (S/E) die de portal toevoegt aan QR-codes
    const spaceId = /^[A-Za-z](?=\d)/.test(rawSpaceId) ? rawSpaceId.slice(1) : rawSpaceId;
    const deptId  = String(qs.deptId  ?? qs.deptid  ?? '').trim();
    const svcId   = String(qs.svcId   ?? qs.svcid   ?? '').trim();
    // Diagnose: ?debug=1 laat Ultimo een diagnose-object teruggeven i.p.v. de prioriteitenlijst
    const debug   = (qs.debug === '1' || qs.debug === 'true');


    if (!spaceId && !deptId && !svcId) {
      return json(400, {
        error: 'Geef spaceId, deptId of svcId mee als query-parameter.',
        debug: { qs, rawQuery: event.rawQuery }
      });
    }

    const { base, env } = detectEnvironment(event);

    const payload = {
      Action: 'GET_PRIORITIES',
      ...(spaceId ? { SpaceId: spaceId } : {}),
      ...(deptId  ? { DepartmentId: deptId } : {}),
      ...(svcId   ? { ServiceContractId: svcId } : {}),
      ...(debug   ? { Debug: '1' } : {})
    };

    const url = `${base}/action/_rest_QueryAtalianJobs`;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'Accept':             'application/json',
        'ApiKey':             API_KEY,
        'ApplicationElementId': APP_ELEMENT
      },
      body: JSON.stringify(payload)
    });

    const txt = await res.text();

    let data;
    try {
      const raw = JSON.parse(txt);
      // Ultimo-structuur: { properties: { Output: { object: "..." } } }
      const objectStr = raw?.properties?.Output?.object ?? raw?.object ?? txt;
      data = typeof objectStr === 'string' ? JSON.parse(objectStr) : objectStr;
    } catch {
      return json(502, { error: 'Ongeldig JSON van Ultimo.', raw: txt.slice(0, 500), env });
    }

    if (!res.ok) {
      return json(res.status, { error: data?.error || `HTTP ${res.status}`, raw: txt.slice(0, 500), env });
    }

    return json(200, { priorities: data, env });

  } catch (err) {
    return json(500, { error: 'Serverfout.', detail: String(err?.message || err) });
  }
}
