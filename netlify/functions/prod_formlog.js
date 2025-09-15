import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  // CORS / healthchecks
  if (event.httpMethod === 'OPTIONS' || event.httpMethod === 'HEAD') {
    return { statusCode: 204, headers: cors() };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(), body: 'Method Not Allowed' };
  }

  let data = {};
  try { data = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 204, headers: cors() }; } // client nooit laten falen

  const now = new Date();
  const code = String(data.code || 'unknown').slice(0,64);
  const day  = now.toISOString().slice(0,10);
  const key  = `${code}/${day}.ndjson`;

  try {
    const store = getStore('formlog');
    const line = JSON.stringify({
      ...data,
      ts_server: now.toISOString(),
      ua: event.headers['user-agent'] || '',
      ip: event.headers['x-forwarded-for'] || '',
    });
    await store.append(key, line + '\n');  // append — geen throw = ok
  } catch (err) {
    console.error('formlog error:', err);  // debug in Netlify logs
    // bewust géén 5xx naar de browser
  }
  return { statusCode: 204, headers: cors() };
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
