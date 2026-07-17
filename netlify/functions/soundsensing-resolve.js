// Omgekeerde Soundsensing-flow: zet een Soundsensing-alarm op 'resolved' zodra de bijhorende
// Ultimo-job op Gereed (Job.Status == 16) staat. Pollend, want Ultimo kan geen server-side
// uitgaande HTTP doen. Spiegelbeeld van soundsensing-sync.js (Blobs-dedup, PROD default).
import { getStore } from '@netlify/blobs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SOUNDSENSING_API_KEY = process.env.SOUNDSENSING_API_KEY;
const SOUNDSENSING_BASE_URL = 'https://api.soundsensing.no/v1';
const ULTIMO_API_KEY = process.env.ULTIMO_API_KEY;
const APP_QUERY = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_BASE_PROD = process.env.ULTIMO_API_BASEURL;
const ULTIMO_BASE_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const ACTION_QUERY = '_rest_QueryAtalianJobs';
const STORE_NAME = 'soundsensing-config';
const STATE_KEY = 'resolve-state'; // apart van de inbound 'state' - eigen teller
const RETENTION_DAYS = 90;
const LOCAL_FALLBACK_PATH = join(tmpdir(), 'soundsensing-resolve-state.json');

// Zelfde robuuste aanpak als soundsensing-sync: expliciete siteID/token indien beschikbaar,
// anders getStore(name); bij MissingBlobsEnvironmentError (bv. lokaal) valt read/write terug
// op een lokaal tmp-bestand.
function getBlobsStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_TOKEN;
  if (siteID && token) return getStore({ name: STORE_NAME, siteID, token });
  return getStore(STORE_NAME);
}

// Zelfde conventie als soundsensing-sync: cron/PROD default, ?env=test schakelt naar TEST.
function detectEnvironment(event = {}) {
  const qs = event.queryStringParameters || {};
  const isTest = qs.test === '1' || qs.test === 'true' || qs.env === 'test';
  return { base: isTest ? ULTIMO_BASE_TEST : ULTIMO_BASE_PROD, label: isTest ? 'TEST' : 'PROD' };
}

// Haal het alarm-UUID uit de job-ExternalId. null = geen Soundsensing-job (skip).
export function parseAlarmIdFromExternalId(ext) {
  if (!ext || typeof ext !== 'string') return null;
  const prefix = 'ss-alarm:';
  return ext.startsWith(prefix) ? ext.slice(prefix.length) : null;
}

export function buildResolveBody(jobId) {
  return { resolved: true, resolution_description: `Opgelost via Ultimo-job ${jobId}` };
}

async function readState() {
  const fallback = { lastCheck: 0, processedResolves: [] };
  try {
    const store = getBlobsStore();
    const raw = await store.get(STATE_KEY, { type: 'text' });
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch (err) {
    if (err.name === 'MissingBlobsEnvironmentError') {
      try {
        const raw = readFileSync(LOCAL_FALLBACK_PATH, 'utf8');
        return { ...fallback, ...JSON.parse(raw) };
      } catch { return fallback; }
    }
    console.error('[soundsensing-resolve] readState fout:', err.message);
    return fallback;
  }
}

async function writeState(state) {
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  state.processedResolves = (state.processedResolves || []).filter(
    (p) => new Date(p.date).getTime() >= cutoff
  );
  try {
    const store = getBlobsStore();
    await store.set(STATE_KEY, JSON.stringify(state), { contentType: 'application/json' });
  } catch (err) {
    if (err.name === 'MissingBlobsEnvironmentError') {
      writeFileSync(LOCAL_FALLBACK_PATH, JSON.stringify(state), 'utf8');
      return;
    }
    throw err;
  }
}

async function fetchFinishedJobs(ultimoBase, since) {
  const res = await fetch(`${ultimoBase}/action/${ACTION_QUERY}`, {
    method: 'POST',
    headers: {
      accept: 'application/json', 'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY, ApplicationElementId: APP_QUERY,
    },
    body: JSON.stringify({ Action: 'GET_FINISHED_SOUNDSENSING_JOBS', Since: since || '' }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ultimo GET_FINISHED fout (${res.status}): ${text.slice(0, 300)}`);
  // De actie levert de JSON in properties.Output.object (string, mogelijk met buitenste quotes),
  // consistent met de andere acties in _rest_QueryAtalianJobs.
  let obj = JSON.parse(text)?.properties?.Output?.object ?? text;
  if (typeof obj === 'string') obj = JSON.parse(obj.replace(/^'|'$/g, '') || '{}');
  return Array.isArray(obj.jobs) ? obj.jobs : [];
}

async function resolveAlarm(alarmId, jobId, dryRun) {
  if (dryRun) {
    console.log(`[soundsensing-resolve] DRYRUN zou alarm ${alarmId} afzetten (job ${jobId})`);
    return true;
  }
  const res = await fetch(`${SOUNDSENSING_BASE_URL}/alarm/${alarmId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${SOUNDSENSING_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildResolveBody(jobId)),
  });
  if (!res.ok) throw new Error(`Soundsensing PUT fout (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function handler(event) {
  const { base: ULTIMO_BASE, label } = detectEnvironment(event);
  const dryRun = (event.queryStringParameters || {}).dryRun === '1';
  console.log(`[soundsensing-resolve] Gestart env=${label} dryRun=${dryRun}`);

  if (!SOUNDSENSING_API_KEY || !ULTIMO_API_KEY || !APP_QUERY || !ULTIMO_BASE) {
    return { statusCode: 500, body: 'Misconfiguratie: env-variabelen ontbreken.' };
  }

  const state = await readState();
  const processed = new Set((state.processedResolves || []).map((p) => p.jobId));

  let jobs = [];
  try {
    const since = state.lastCheck ? new Date(state.lastCheck * 1000).toISOString() : '';
    jobs = await fetchFinishedJobs(ULTIMO_BASE, since);
  } catch (e) {
    console.error('[soundsensing-resolve]', e.message);
    return { statusCode: 502, body: e.message };
  }

  let resolved = 0, skipped = 0, failed = 0;
  for (const job of jobs) {
    if (processed.has(job.JobId)) { skipped++; continue; }
    const alarmId = parseAlarmIdFromExternalId(job.ExternalId);
    if (!alarmId) { skipped++; continue; }
    try {
      await resolveAlarm(alarmId, job.JobId, dryRun);
      if (!dryRun) state.processedResolves.push({ jobId: job.JobId, date: new Date().toISOString() });
      resolved++;
    } catch (e) {
      console.error(`[soundsensing-resolve] job ${job.JobId}:`, e.message);
      failed++; // job niet als verwerkt markeren -> volgende run opnieuw proberen
    }
  }

  // lastCheck enkel opschuiven bij een volledig geslaagde run (zoals de inbound flow).
  if (!dryRun && failed === 0) state.lastCheck = Math.floor(Date.now() / 1000);
  if (!dryRun) await writeState(state);

  const summary = { ok: true, env: label, dryRun, resolved, skipped, failed, seen: jobs.length };
  console.log('[soundsensing-resolve] Klaar', summary);
  return { statusCode: 200, body: JSON.stringify(summary) };
}
