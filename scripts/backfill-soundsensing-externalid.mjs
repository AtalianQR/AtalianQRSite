#!/usr/bin/env node
// Eenmalige backfill: zet op bestaande Soundsensing-jobs de juiste ss-alarm:<alarm-uuid> in
// ExternalId, zodat de omgekeerde flow (job gereed -> alarm afzetten) ook voor bestaande jobs werkt.
//
// Koppeling job -> alarm: device_id (uit Kenmerk SoundsensingID 000162 van de installatie)
// + het alarmtijdstip uit de jobtitel "(DD.MM.JJJJ UU:MM)" (UTC, zoals soundsensing-sync het schrijft).
//
// Gebruik:
//   node scripts/backfill-soundsensing-externalid.mjs            # DRY-RUN tegen TEST (schrijft niets)
//   node scripts/backfill-soundsensing-externalid.mjs --apply    # schrijft de ExternalId's (TEST)
//   node scripts/backfill-soundsensing-externalid.mjs --prod --apply   # tegen PRODUCTIE
//
// Env: SOUNDSENSING_API_KEY, ULTIMO_API_KEY, APP_ELEMENT_QueryAtalianJobs,
//      ULTIMO_API_BASEURL (prod) en/of ULTIMO_API_BASEURL_TEST (test).

// PROD/APPLY via vlag OF env-var (env-var nodig omdat `netlify dev:exec` de --vlaggen zelf opslokt).
const APPLY = process.argv.includes('--apply') || process.env.BACKFILL_APPLY === '1';
const PROD = process.argv.includes('--prod') || process.env.BACKFILL_TARGET === 'prod';

const SOUNDSENSING_API_KEY = process.env.SOUNDSENSING_API_KEY;
const SOUNDSENSING_BASE_URL = 'https://api.soundsensing.no/v1';
const ULTIMO_API_KEY = process.env.ULTIMO_API_KEY;
const APP_QUERY = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_BASE = PROD
  ? (process.env.ULTIMO_API_BASEURL || 'https://atalian.ultimo.net/api/v1')
  : (process.env.ULTIMO_API_BASEURL_TEST || 'https://atalian-test.ultimo.net/api/v1');
const ACTION = '_rest_QueryAtalianJobs';

function requireEnv() {
  const missing = [];
  if (!SOUNDSENSING_API_KEY) missing.push('SOUNDSENSING_API_KEY');
  if (!ULTIMO_API_KEY) missing.push('ULTIMO_API_KEY');
  if (!APP_QUERY) missing.push('APP_ELEMENT_QueryAtalianJobs');
  if (missing.length) { console.error('Ontbrekende env-vars:', missing.join(', ')); process.exit(1); }
}

// Roept een Ultimo-actie aan en parset properties.Output.object (string, evt. met buitenste quotes).
async function ultimoAction(action, extra = {}) {
  const res = await fetch(`${ULTIMO_BASE}/action/${ACTION}`, {
    method: 'POST',
    headers: {
      accept: 'application/json', 'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY, ApplicationElementId: APP_QUERY,
    },
    body: JSON.stringify({ Action: action, ...extra }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ultimo ${action} fout (${res.status}): ${text.slice(0, 300)}`);
  let obj = JSON.parse(text)?.properties?.Output?.object ?? text;
  if (typeof obj === 'string') obj = JSON.parse(obj.replace(/^'|'$/g, '') || '{}');
  return obj;
}

// "(DD.MM.JJJJ UU:MM)" uit de jobtitel -> unix-minuut (UTC). null als niet gevonden.
export function titleMinuteUtc(jobDescr) {
  const m = /\((\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})\)/.exec(jobDescr || '');
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  return Math.floor(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, 0) / 60000);
}

const alarmCache = new Map(); // device_id -> [alarms]
async function alarmsForDevice(deviceId) {
  if (alarmCache.has(deviceId)) return alarmCache.get(deviceId);
  const res = await fetch(`${SOUNDSENSING_BASE_URL}/alarm?device=${deviceId}`, {
    headers: { Authorization: `Bearer ${SOUNDSENSING_API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Soundsensing /alarm fout (${res.status})`);
  const body = await res.json();
  const list = Array.isArray(body?.data) ? body.data : (body?.data ? [body.data] : []);
  alarmCache.set(deviceId, list);
  return list;
}

async function main() {
  requireEnv();
  console.log(`Backfill ExternalId - omgeving=${PROD ? 'PROD' : 'TEST'} (${ULTIMO_BASE}) - modus=${APPLY ? 'APPLY (schrijft)' : 'DRY-RUN'}`);

  const [{ jobs = [] }, { devices = [] }] = await Promise.all([
    ultimoAction('LIST_SOUNDSENSING_JOBS'),
    ultimoAction('LIST_SS_DEVICES'),
  ]);
  const deviceByEqm = new Map(devices.map((d) => [d.EquipmentId, d.DeviceUuid]));
  console.log(`Jobs met ss-% ExternalId: ${jobs.length} | installaties met SoundsensingID: ${devices.length}\n`);

  const plan = []; // {JobId, oldExt, deviceId, titleMin, newExt, status}
  for (const job of jobs) {
    if (String(job.ExternalId || '').startsWith('ss-alarm:')) {
      plan.push({ ...job, status: 'AL GEBACKFILD', newExt: job.ExternalId });
      continue;
    }
    const deviceId = deviceByEqm.get(job.EquipmentId);
    const tMin = titleMinuteUtc(job.JobDescr);
    if (!deviceId) { plan.push({ ...job, deviceId, status: 'GEEN DEVICE (Kenmerk 000162 leeg)' }); continue; }
    if (tMin == null) { plan.push({ ...job, deviceId, status: 'GEEN TIJDSTIP in titel' }); continue; }

    let matches;
    try {
      const alarms = await alarmsForDevice(deviceId);
      matches = alarms.filter((a) => Math.floor(Number(a.timestamp ?? a.created_at) / 60) === tMin);
    } catch (e) { plan.push({ ...job, deviceId, status: `SOUNDSENSING FOUT: ${e.message}` }); continue; }

    if (matches.length === 1) {
      plan.push({ ...job, deviceId, status: 'MATCH', newExt: `ss-alarm:${matches[0].id}` });
    } else {
      plan.push({ ...job, deviceId, status: matches.length === 0 ? 'GEEN ALARM-MATCH' : `AMBIGU (${matches.length})` });
    }
  }

  // Overzicht
  for (const p of plan) {
    console.log(`${p.JobId}  [${p.status}]  ${p.EquipmentId || '-'}  ${p.newExt ? '-> ' + p.newExt : ''}`);
  }
  const toApply = plan.filter((p) => p.status === 'MATCH');
  console.log(`\nSamenvatting: ${toApply.length} te backfillen, ${plan.filter(p=>p.status==='AL GEBACKFILD').length} al gedaan, ${plan.length - toApply.length - plan.filter(p=>p.status==='AL GEBACKFILD').length} zonder eenduidige match.`);

  if (!APPLY) { console.log('\nDRY-RUN: er is niets geschreven. Draai met --apply om de ExternalId\'s te zetten.'); return; }

  console.log('\n--apply: ExternalId\'s wegschrijven...');
  let ok = 0, fail = 0;
  for (const p of toApply) {
    try {
      await ultimoAction('SET_JOB_EXTERNALID', { JobId: p.JobId, NewExternalId: p.newExt });
      console.log(`  OK  ${p.JobId} -> ${p.newExt}`);
      ok++;
    } catch (e) { console.error(`  FOUT ${p.JobId}: ${e.message}`); fail++; }
  }
  console.log(`\nKlaar: ${ok} gezet, ${fail} mislukt.`);
}

import { pathToFileURL } from 'node:url';
// Enkel uitvoeren als dit bestand rechtstreeks gestart wordt (niet bij import vanuit een test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('FOUT:', e.message); process.exit(1); });
}
