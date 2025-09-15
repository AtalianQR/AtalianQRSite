// netlify/functions/prod_formlog.js
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS' || event.httpMethod === 'HEAD') {
    return { statusCode: 204, headers: corsHeaders() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method Not Allowed' };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: 'Invalid JSON' }; }

  const now  = new Date();
  const code = String(data.code || 'unknown').slice(0, 64);
  const day  = now.toISOString().slice(0,10);
  const key  = `${code}/${day}.ndjson`;

  try {
    const store = getStore('formlog');            // blob store
    const line = JSON.stringify({
      ...data,
      ts_server: now.toISOString(),
      ua: event.headers['user-agent'] || '',
      ip: event.headers['x-forwarded-for'] || '',
    });
    await store.append(key, line + '\n');         // append als NDJSON
    return { statusCode: 204, headers: corsHeaders() };
  } catch (err) {
    console.error('formlog error', err);
    return { statusCode: 500, headers: corsHeaders(), body: 'error' };
  }
};

function corsHeaders(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
