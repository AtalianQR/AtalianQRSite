// netlify/functions/priorities.js
/* eslint-disable */

const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;

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

    const qs        = event.queryStringParameters || {};
    const spaceId   = String(qs.spaceId   ?? '').trim();
    const deptId    = String(qs.deptId    ?? '').trim();

    if (!spaceId && !deptId) {
      return json(400, { error: 'Geef spaceId of deptId mee als query-parameter.' });
    }

    const { base, env } = detectEnvironment(event);

    const payload = {
      Action: 'GET_PRIORITIES',
      ...(spaceId ? { SpaceId: spaceId } : {}),
      ...(deptId  ? { DepartmentId: deptId } : {})
    };

    const url = `${base}/action/_rest_QueryAtalianJobs`;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
        'ApiKey':        API_KEY
      },
      body: JSON.stringify(payload)
    });

    const txt = await res.text();
    let data;
    try {
      data = JSON.parse(txt);
      if (data && typeof data.object === 'string') {
        data = JSON.parse(data.object);
      }
    } catch {
      return json(502, { error: 'Ongeldig JSON van Ultimo.', raw: txt.slice(0, 500), env });
    }

    if (!res.ok) {
      return json(res.status, { error: data?.error || `HTTP ${res.status}`, env });
    }

    return json(200, { priorities: data, env });

  } catch (err) {
    return json(500, { error: 'Serverfout.', detail: String(err?.message || err) });
  }
}
