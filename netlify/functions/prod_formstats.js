const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const qs   = event.queryStringParameters || {};
  const code = qs.code || 'unknown';
  const from = (qs.from || '1970-01-01').slice(0,10);
  const to   = (qs.to   || new Date().toISOString().slice(0,10)).slice(0,10);

  const store = getStore('formlog');
  const prefix = `${code}/`;

  // alle keys voor dit code-prefix ophalen
  const keys = [];
  for await (const { key } of store.list({ prefix })) keys.push(key);

  // filter op datumrange + inlezen
  const texts = [];
  for (const key of keys) {
    const d = key.slice(prefix.length).replace('.ndjson','');
    if (d >= from && d <= to) {
      const text = await store.get(key); // hele NDJSON
      if (text) texts.push(text);
    }
  }

  // parsen naar events
  const events = [];
  for (const chunk of texts) {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch {}
    }
  }

  // simpele aggregatie
  const steps = {};              // per stepnaam
  let attempts = 0, successes = 0;

  for (const ev of events) {
    if (ev.type === 'step') {
      const k = ev.step || 'unknown';
      steps[k] = (steps[k] || 0) + 1;
      attempts++;                // een step = een poging
    }
    if (ev.type === 'desc_entered' || ev.type === 'submit_attempt') attempts++;
    if (ev.type === 'submit_success') successes++;
  }

  return {
    statusCode: 200,
    headers: { 'content-type':'application/json' },
    body: JSON.stringify({ ok:true, code, from, to, attempts, successes, steps })
  };
};
