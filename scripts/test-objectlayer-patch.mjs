#!/usr/bin/env node
// Test: kan de OBJECTLAAG (PATCH /object/Job) de ExternalId van een AFGESLOTEN job wijzigen,
// daar waar de actie-laag (Update) op de job-lock botst? Eenmalige backfill-verkenning.
// Draai:  $env:BACKFILL_TARGET="prod"; npx netlify dev:exec node scripts/test-objectlayer-patch.mjs
const PROD = process.argv.includes('--prod') || process.env.BACKFILL_TARGET === 'prod';
const KEY = process.env.ULTIMO_API_KEY;
const BASE = PROD
  ? (process.env.ULTIMO_API_BASEURL || 'https://atalian.ultimo.net/api/v1')
  : (process.env.ULTIMO_API_BASEURL_TEST || 'https://atalian-test.ultimo.net/api/v1');

const JOB = '093688';
const NEW_EXT = 'ss-alarm:1db0eb49-7acf-4277-b967-aa33fb737e28';

async function getJob() {
  const res = await fetch(`${BASE}/object/Job('${JOB}')`, { headers: { ApiKey: KEY, accept: 'application/json' } });
  const t = await res.text();
  return { status: res.status, body: t };
}

async function main() {
  console.log(`Omgeving=${PROD ? 'PROD' : 'TEST'} (${BASE})  job=${JOB}\n`);

  const before = await getJob();
  console.log(`GET vooraf (HTTP ${before.status}):`, before.body.slice(0, 400), '\n');

  console.log(`PATCH ExternalId -> ${NEW_EXT} ...`);
  const patch = await fetch(`${BASE}/object/Job('${JOB}')`, {
    method: 'PATCH',
    headers: { ApiKey: KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ ExternalId: NEW_EXT }),
  });
  console.log(`PATCH resultaat: HTTP ${patch.status}`, (await patch.text()).slice(0, 300), '\n');

  const after = await getJob();
  const m = /"ExternalId"\s*:\s*"([^"]*)"/.exec(after.body);
  console.log(`GET achteraf: ExternalId = ${m ? m[1] : '(niet gevonden)'}`);
  console.log(m && m[1] === NEW_EXT ? '\n=> OBJECTLAAG WERKT op afgesloten job! We kunnen de backfill zo doen.' : '\n=> Objectlaag wijzigde niets. Andere aanpak nodig.');
}
main().catch((e) => { console.error('FOUT:', e.message); process.exit(1); });
