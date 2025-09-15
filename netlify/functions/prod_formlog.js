// netlify/functions/prod_formlog.js
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const method = (event.httpMethod || '').toUpperCase();
  const q = event.queryStringParameters || {};

  // ✅ healthchecks: laat HEAD/OPTIONS/GET slagen
  if (method === 'HEAD' || method === 'OPTIONS') {
    return { statusCode: 204, headers: cors() };
  }
  if (method === 'GET') {
    return {
      statusCode: 200,
      headers: { ...cors(), 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  }
  if (method !== 'POST') {
    return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
  }

  // --- echte beacon logging (POST) ---
  let data = {};
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    // slik JSON-fout (geen lawaai naar client)
    return { statusCode: 204, headers: cors() };
  }

  const now = new Date();
  const code = String(data.code || 'unknown').slice(0, 64);
  const day  = now.toISOString().slice(0, 10);
  const key  = `${code}/${day}.ndjson`;

  try {
    // ✅ store binnen de handler + fallback via env (lokaal)
    const store = createStore();

    const line = JSON.stringify({
      ...data,
      ts_server: now.toISOString(),
      ua: event.headers?.['user-agent'] || '',
      ip: event.headers?.['x-forwarded-for'] || event.headers?.['client-ip'] || ''
    });

    await store.append(key, line + '\n');

    // Handige debug: ?debug=1 geeft 200 + details i.p.v. 204
    if (q.debug === '1') {
      return {
        statusCode: 200,
        headers: { ...cors(), 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, key, bytes: (line + '\n').length })
      };
    }
  } catch (err) {
    console.error('formlog error:', err); // check Netlify Function logs
    if (q.debug === '1') {
      return {
        statusCode: 500,
        headers: { ...cors(), 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: String(err) })
      };
    }
  }

  return { statusCode: 204, headers: cors() };
};

// ===== helpers =====
function createStore() {
  try {
    // In Netlify productie: automatisch geconfigureerd
    return getStore('formlog');
  } catch (e) {
    // Lokaal / buiten Netlify: optionele fallback via env
    if (String(e?.name || e).includes('MissingBlobsEnvironmentError')) {
      const siteID = process.env.NETLIFY_SITE_ID || process.env.NF_SITE_ID;
      const token  = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
      if (siteID && token) return getStore('formlog', { siteID, token });
    }
    throw e;
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
