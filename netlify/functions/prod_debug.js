// netlify/functions/prod_debug.js
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  try {
    const u = new URL(
      event.rawUrl ||
      event.headers?.['x-forwarded-url'] ||
      'http://x'
    );
    const code = (u.searchParams.get('code') || '').trim();
    const prefix = code ? `${code}/` : '';

    // ✅ Blobs-store binnen de handler + fallback via env
    const store = createStore();

    // 1) toon keys
    const { blobs } = await store.list({ prefix });

    // 2) lees de laatste 3 regels van max. 10 meest recente keys
    const items = [];
    // NB: blobs is niet gegarandeerd gesorteerd → pak de laatste 10 zoals ze komen
    for (const { key, size } of blobs.slice(-10)) {
      const text  = await store.get(key, { type: 'text' });
      const lines = (text || '').trim().split('\n');
      const tail  = lines.slice(-3).map(s => { try { return JSON.parse(s); } catch { return s; }});
      items.push({ key, size, tail });
    }

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ ok: true, prefix, count: blobs.length, items })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: String(err) })
    };
  }
};

// === helpers ===
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
