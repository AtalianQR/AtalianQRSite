// CJS – draait op Netlify Functions (Node 18/20)
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let data = {};
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const now  = new Date();
  const code = String(data.code || 'unknown').slice(0, 64);  // korte key
  const day  = now.toISOString().slice(0,10);                // YYYY-MM-DD
  const key  = `${code}/${day}.ndjson`;

  const store = getStore('formlog'); // “formlog” = je blob store naam
  const line = JSON.stringify({
    ...data,
    ts_server: now.toISOString(),
    ua: (event.headers['user-agent'] || ''),
    ip: (event.headers['x-forwarded-for'] || ''),
  });

  // append als NDJSON
  await store.append(key, line + '\n');

  // 204: geen body nodig – perfect voor sendBeacon
  return { statusCode: 204 };
};
