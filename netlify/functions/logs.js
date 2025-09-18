\
/**
 * Netlify Function v1 (CommonJS): /.netlify/functions/logs
 * Robuuste proxy met CORS en defensieve JSON-normalisatie.
 */
const fetch = global.fetch || require('node-fetch'); // voor oudere runtimes
const UPSTREAM = process.env.UPSTREAM_LOGS_URL || 'https://atalian-logs.atalianqr.workers.dev/api/log';
const TIMEOUT_MS = 8000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json'
};

exports.handler = async function(event, context) {
  try {
    // Preflight
    if (event.httpMethod === 'OPTIONS' || event.httpMethod === 'HEAD') {
      return { statusCode: 204, headers: CORS, body: '' };
    }

    // Querystring doorgeven
    const qs = event.rawQuery ? ('?' + event.rawQuery) : '';

    // Headers doorgeven
    const headersOut = { 'Accept': 'application/json' };
    if (event.headers && event.headers['content-type']) {
      headersOut['Content-Type'] = event.headers['content-type'];
    }
    if (event.headers && (event.headers['authorization'] || event.headers['Authorization'])) {
      headersOut['Authorization'] = event.headers['authorization'] || event.headers['Authorization'];
    }

    // Body doorgeven voor niet-GET
    const init = { method: event.httpMethod || 'GET', headers: headersOut };
    if (init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = event.body || '';
    }

    // Timeout
    const ctrl = new AbortController();
    const tm = setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
    init.signal = ctrl.signal;

    // Fetch naar upstream
    let payload;
    const res = await fetch(UPSTREAM + qs, init).catch(err => {
      return { ok:false, status:599, statusText:'FETCH_ERROR', json:async()=>{throw err;}, text:async()=>String(err) };
    });

    // Decodeer JSON of tekst
    try {
      payload = await res.json();
    } catch (_) {
      try {
        const t = await res.text();
        payload = { ok:false, proxy:'html-fallback', status:res.status, statusText:res.statusText, body:String(t).slice(0,800) };
      } catch (e2) {
        payload = { ok:false, proxy:'no-body', status:res.status, statusText:res.statusText };
      }
    } finally {
      clearTimeout(tm);
    }

    // Normaliseer output: altijd { items: [...] , error?: any }
    const normalized = Array.isArray(payload) ? { items: payload }
                     : (Array.isArray(payload.items) ? { items: payload.items }
                     : (Array.isArray(payload.logs) ? { items: payload.logs }
                     : { items: [], error: payload }));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(normalized)
    };
  } catch (e) {
    const error = { ok:false, proxy:'exception', error: String(e && e.message ? e.message : e) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [], error }) };
  }
};
