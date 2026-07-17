#!/usr/bin/env node
// Diagnose: werkt de ObjectFeature/Kenmerk-000162-query in deze omgeving?
// Draai met:  npx netlify dev:exec node scripts/diag-ss-kenmerk.mjs        (TEST)
//             npx netlify dev:exec node scripts/diag-ss-kenmerk.mjs --prod (PROD)
const PROD = process.argv.includes('--prod') || process.env.BACKFILL_TARGET === 'prod';
const ULTIMO_API_KEY = process.env.ULTIMO_API_KEY;
const APP_QUERY = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_BASE = PROD
  ? (process.env.ULTIMO_API_BASEURL || 'https://atalian.ultimo.net/api/v1')
  : (process.env.ULTIMO_API_BASEURL_TEST || 'https://atalian-test.ultimo.net/api/v1');

// Bekend: device 6305c036... hoort bij installatie 021257 (matchte in de sync).
const KNOWN_UUID = '6305c036-7c34-4ecf-b472-9fd11ba6ca10';

async function call(action, extra = {}) {
  const res = await fetch(`${ULTIMO_BASE}/action/_rest_QueryAtalianJobs`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', ApiKey: ULTIMO_API_KEY, ApplicationElementId: APP_QUERY },
    body: JSON.stringify({ Action: action, ...extra }),
  });
  const text = await res.text();
  console.log(`\n=== ${action} (HTTP ${res.status}) ===`);
  console.log('RAW:', text.slice(0, 800));
}

async function main() {
  console.log(`Omgeving=${PROD ? 'PROD' : 'TEST'} (${ULTIMO_BASE})`);
  await call('GET_EQUIPMENT_BY_SERIAL', { SerialNumber: KNOWN_UUID }); // verwacht 021257 als Kenmerk-query werkt
  await call('LIST_SS_DEVICES');                                       // verwacht lijst met alle 000162-installaties
}
main().catch((e) => { console.error('FOUT:', e.message); process.exit(1); });
