// netlify/functions/prod_formstats.js
import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const qs = event.queryStringParameters || {};
  const code = qs.code || 'unknown';
  const from = (qs.from || '1970-01-01').slice(0,10);
  const to   = (qs.to   || new Date().toISOString().slice(0,10)).slice(0,10);

  try {
    const store = getStore('formlog');
    const prefix = `${code}/`;

    const keys = [];
    for await (const { key } of store.list({ prefix })) {
      const d = key.slice(prefix.length).replace('.ndjson','');
      if (d >= from && d <= to) keys.push(key);
    }

    const steps = {};
    let attempts = 0, successes = 0;

    for (const k of keys) {
      const text = await store.get(k);
      if (!text) continue;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'step') {
          const s = ev.step || 'unknown';
          steps[s] = (steps[s] || 0) + 1;
          attempts++;
        }
        if (ev.type === 'desc_entered' || ev.type === 'submit_attempt') attempts++;
        if (ev.type === 'submit_success') successes++;
      }
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok:true, code, from, to, attempts, successes, steps }),
    };
  } catch (err) {
    console.error('formstats error', err);
    return { statusCode: 500, body: JSON.stringify({ ok:false }) };
  }
};
