/**
 * Netlify Function v1 (CommonJS) — ultra-compat
 * - Geen ESM
 * - Geen AbortController
 * - Lazy require van node-fetch binnen handler
 * - Altijd JSON response { items: [], error?: any }
 */
exports.handler = async function(event, context) {
  // CORS headers
  var CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };

  try {
    if (event.httpMethod === 'OPTIONS' || event.httpMethod === 'HEAD') {
      return { statusCode: 204, headers: CORS, body: '' };
    }

    // Upstream URL
    var upstream = process.env.UPSTREAM_LOGS_URL || 'https://atalian-logs.atalianqr.workers.dev/api/log';

    // Build outbound request
    var qs = event.rawQuery ? ('?' + event.rawQuery) : '';
    var headersOut = { 'Accept': 'application/json' };
    if (event.headers && event.headers['content-type']) headersOut['Content-Type'] = event.headers['content-type'];
    if (event.headers && event.headers['authorization']) headersOut['Authorization'] = event.headers['authorization'];
    if (event.headers && event.headers['Authorization']) headersOut['Authorization'] = event.headers['Authorization'];

    var init = { method: event.httpMethod || 'GET', headers: headersOut };
    if (init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = event.body || '';
    }

    // Prepare fetch (lazy require node-fetch indien nodig)
    var _fetch = (typeof fetch !== 'undefined') ? fetch : null;
    if (!_fetch) {
      try {
        _fetch = require('node-fetch');
        if (_fetch && _fetch.default) _fetch = _fetch.default; // ESM default interop
      } catch (e) {
        var err = { ok:false, proxy:'node-fetch-missing', error:String(e && e.message ? e.message : e) };
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [], error: err }) };
      }
    }

    // Timeout via Promise.race
    var TIMEOUT_MS = 8000;
    var timeoutPromise = new Promise(function(resolve){
      setTimeout(function(){ resolve({ _timeout:true }); }, TIMEOUT_MS);
    });

    var upstreamPromise = _fetch(upstream + qs, init).then(function(res){
      return res.text().then(function(txt){
        return { _timeout:false, status: res.status, statusText: res.statusText, bodyText: txt };
      });
    }).catch(function(e){
      return { _timeout:false, status: 599, statusText: 'FETCH_ERROR', bodyText: String(e && e.message ? e.message : e) };
    });

    var outcome = await Promise.race([timeoutPromise, upstreamPromise]);

    // Handle outcomes
    if (outcome._timeout) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [], error: { ok:false, proxy:'timeout', ms: TIMEOUT_MS } }) };
    }

    // Try parse JSON
    var payload;
    try {
      payload = JSON.parse(outcome.bodyText);
    } catch (ejson) {
      payload = { ok:false, proxy:'html-fallback', status: outcome.status, statusText: outcome.statusText, body: String(outcome.bodyText).slice(0,800) };
    }

    // Normalize
    var normalized;
    if (Array.isArray(payload)) {
      normalized = { items: payload };
    } else if (payload && Array.isArray(payload.items)) {
      normalized = { items: payload.items };
    } else if (payload && Array.isArray(payload.logs)) {
      normalized = { items: payload.logs };
    } else {
      normalized = { items: [], error: payload };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(normalized) };
  } catch (e) {
    var error = { ok:false, proxy:'exception', error: String(e && e.message ? e.message : e) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [], error: error }) };
  }
};
