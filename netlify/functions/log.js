// netlify/functions/log.js
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const store = getStore({ name: 'tickets' }); // 1 “bucket” met records

  try {
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const id = crypto.randomUUID();
      const record = {
        id,
        ts: Date.now(),
        contextLabel: data.contextLabel || '',
        urgent: data.urgent === 'ja' ? 'ja' : 'nee',
        desc: data.desc || '',
        email: data.email || '',
        photo: !!data.photo,
        lang: (data.lang || 'nl').toLowerCase(),
        ua: event.headers['user-agent'] || ''
      };
      // Bewaar als JSON document
      await store.setJSON(id, record);
      return { statusCode: 201, headers, body: JSON.stringify({ ok:true, id }) };
    }

    if (event.httpMethod === 'GET') {
      // Alle keys ophalen en records inlezen
      const { keys } = await store.list();
      const items = [];
      for (const key of keys) {
        const rec = await store.getJSON(key);
        if (rec) items.push(rec);
      }
      items.sort((a,b)=>b.ts-a.ts);

      // Aggregaties
      const countBy = (arr, k, map=(x)=>x) =>
        arr.reduce((acc,r)=>{ const kk = map(r[k]); acc[kk]=(acc[kk]||0)+1; return acc; },{});
      const totals = {
        total: items.length,
        perScenario: countBy(items,'contextLabel'),
        urgent: countBy(items,'urgent', v => v==='ja'?'dringend':'kan wachten'),
        photo: countBy(items,'photo', v => v ? 'met foto' : 'zonder foto'),
        lang: countBy(items,'lang')
      };

      return { statusCode: 200, headers, body: JSON.stringify({ ok:true, items, totals }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ ok:false, error:'Method not allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok:false, error:String(e) }) };
  }
};
