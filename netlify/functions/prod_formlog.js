// netlify/functions/prod_formlog.js
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const method = (event.httpMethod || '').toUpperCase();

  // ✅ healthchecks: laat HEAD/OPTIONS/GET gewoon slagen
  if (method === 'HEAD' || method === 'OPTIONS') {
    return { statusCode: 204, headers: cors() };
  }
  if (method === 'GET') {
    return { statusCode: 200, headers: { ...cors(), 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  if (method !== 'POST') {
    return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
  }

  // --- echte beacon logging (POST) ---
  let data = {};
  try { data = JSON.parse(event.body || '{}'); } catch { /* slik, maar 204 terug */ return { statusCode: 204, headers: cors() }; }

  const now  = new Date();
  const code = String(data.code || 'unknown').slice(0, 64);
  const day  = now.toISOString().slice(0,10);
  const key  = `${code}/${day}.ndjson`;

  try {
    const store = getStore('formlog');
    const line = JSON.stringify({
      ...data,
      ts_server: now.toISOString(),
      ua: event.headers['user-agent'] || '',
      ip: event.headers['x-forwarded-for'] || ''
    });
    await store.append(key, line + '\n');
  } catch (err) {
    console.error('formlog error:', err); // zie Netlify logs
    // bewust géén 5xx naar client
  }
  return { statusCode: 204, headers: cors() };
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
