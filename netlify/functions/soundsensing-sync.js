// netlify/functions/soundsensing-sync.js
// Scheduled function — controleert periodiek op nieuwe Soundsensing-alarmen
// en maakt een Ultimo-job aan voor elk alarm dat aan een gekende installatie koppelt.
/* eslint-disable */

import { getStore } from '@netlify/blobs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileSync, writeFileSync } from 'fs';

// === ENV ============================================================
const SOUNDSENSING_API_KEY = process.env.SOUNDSENSING_API_KEY;
const SOUNDSENSING_BASE_URL = 'https://api.soundsensing.no/v1';

const ULTIMO_API_KEY   = process.env.ULTIMO_API_KEY;
const ULTIMO_BASE_PROD = process.env.ULTIMO_API_BASEURL;
const ULTIMO_BASE_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_QUERY  = process.env.APP_ELEMENT_QueryAtalianJobs;
const APP_CREATE = process.env.APP_ELEMENT_OneAtalianJob;
const ACTION_QUERY  = '_rest_QueryAtalianJobs';
const ACTION_CREATE = process.env.ULTIMO_ACTION_CREATE_JOB || '_REST_OneAtalianJob';

// Omgevingsdetectie - zelfde patroon als equipment.js/jobs.js/melding.js elders in deze repo:
// standaard PRODUCTIE, enkel TEST bij expliciete ?env=test (handig voor manueel testen, een
// cron-trigger geeft nooit queryStringParameters mee en valt dus altijd op PROD terug).
function detectEnvironment(event = {}) {
  const qs = event.queryStringParameters || {};
  const isTest = qs.test === '1' || qs.test === 'true' || qs.env === 'test';
  const base = isTest ? ULTIMO_BASE_TEST : ULTIMO_BASE_PROD;
  const label = isTest ? 'TEST' : 'PROD';
  return { base, label };
}

const BLOBS_STORE = 'soundsensing-config';
const STATE_KEY = 'state';
const PROCESSED_MAX_AGE_DAYS = 90;

// Soundsensing publiceert alarmen met vertraging (tot enkele uren - eigen alarm-mail deed er ooit
// ~4u over, zie plan-document). Een opschuivend venster op basis van "laatste check" liep daardoor
// het risico een alarm te missen: het bestond nog niet op het moment van checken, en tegen de tijd
// dat het wél verscheen, was de teller er al voorbij (incident 24/06/2026 - alarm 49d5bd06/021257
// nooit verwerkt omdat lastCheck er ondertussen al overheen was geschoven).
// Daarom: elke run kijkt altijd een vaste, ruime periode terug, los van de vorige check-tijd.
// De enige bescherming tegen dubbele jobs is de alarm-ID-deduplicatie (processedAlarms hieronder).
const LOOKBACK_SECONDS = 12 * 3600;

// === Blobs helpers (zelfde patroon als dmassistent.js, met lokale fallback voor netlify dev) ====
const LOCAL_FALLBACK_PATH = join(tmpdir(), 'soundsensing-sync-state.json');

function getBlobsStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_TOKEN;
  if (siteID && token) return getStore({ name: BLOBS_STORE, siteID, token });
  return getStore(BLOBS_STORE);
}

async function readState() {
  const fallback = { lastCheck: 0, processedAlarms: [] };
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
    console.error('[soundsensing-sync] readState fout:', err.message);
    return fallback;
  }
}

async function writeState(state) {
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

// === Soundsensing ====================================================
async function fetchNewAlarms(startTimeUnix) {
  const url = `${SOUNDSENSING_BASE_URL}/alarm?start_time=${startTimeUnix}&resolved=false`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SOUNDSENSING_API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Soundsensing API fout (${res.status}): ${text.slice(0, 500)}`);
  }
  const body = await res.json();
  return Array.isArray(body?.data) ? body.data : [];
}

// === Ultimo ==========================================================
// GET_EQUIPMENT_BY_SERIAL geeft bij geen match de string "'{}'" terug (met letterlijke
// enkele aanhalingstekens) - zie plan-document. Die laag wordt hier opgevangen.
function parseActionOutput(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  const trimmed = String(s).trim().replace(/^'(.*)'$/, '$1');
  if (!trimmed || trimmed === '{}') return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

async function findEquipmentBySerial(ultimoBase, deviceId) {
  const url = `${ultimoBase}/action/${ACTION_QUERY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY,
      ApplicationElementId: APP_QUERY,
    },
    body: JSON.stringify({ Action: 'GET_EQUIPMENT_BY_SERIAL', SerialNumber: deviceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ultimo GET_EQUIPMENT_BY_SERIAL fout (${res.status}): ${text.slice(0, 500)}`);
  }
  const body = await res.json();
  return parseActionOutput(body); // null, of {EquipmentId, Description}
}

function extractJobId(text) {
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  const direct = body?.properties?.jobid || body?.properties?.JobId || body?.jobid || body?.JobId;
  if (direct) return String(direct);
  const m = String(text).match(/"jobid"\s*:\s*"?(\d{4,})"?/i);
  return m ? m[1] : null;
}

// Soundsensing alarm_type: "A" = trilling-afwijking, "B" = schema-afwijking, andere/onbekend = rest
// Let op: 📳 en 📅 liggen buiten het Basic Multilingual Plane (surrogate pairs) en renderen als
// een leeg "tofu"-vierkantje in Ultimo's Job-titelveld (bevestigd via test - job 093241/093242)
// en in quickchart.io's grafiektitel. ⚠️ ligt wel binnen de BMP en rendert overal correct.
// Bewust toch behouden zoals afgesproken.
function alarmTypeLabel(alarmType) {
  if (alarmType === 'A') return '📳 Trilling-afwijking';
  if (alarmType === 'B') return '📅 Schema-afwijking';
  return '⚠️ Andere afwijking';
}

async function createUltimoJob(ultimoBase, equipmentId, description, alarmType) {
  const url = `${ultimoBase}/action/${ACTION_CREATE}`;
  const externalId = `ss-${Date.now()}-${Math.random().toString(36).slice(2)}`.slice(0, 48);
  const titlePrefix = alarmTypeLabel(alarmType);
  const jobDescr = `${titlePrefix} - ${String(description || 'Soundsensing alarm').trim()}`;
  const payload = {
    JobDescr: jobDescr.slice(0, 500),
    Provider: 'QRConnectEqm',
    EquipmentId: equipmentId,
    ReportText: 'Kanaal: SoundsensingSync | GPS: unavailable<br>Zie tabblad Documentatie voor de vibratiehistoriek rond dit alarm.',
    ExternalId: externalId,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY,
      ApplicationElementId: APP_CREATE,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Ultimo job-aanmaak fout (${res.status}): ${text.slice(0, 500)}`);
  return { raw: text, jobId: extractJobId(text) };
}

// === Grafiek: vibratiehistoriek vóór het alarm, als bijlage bij het ticket ====
const QUICKCHART_URL = 'https://quickchart.io/chart';
const CHART_LOOKBACK_HOURS_VIBRATION = 7 * 24; // trilling-alarm (type A): 7 dagen, zelfde als "Last 7 days" in de Soundsensing app
const CHART_LOOKBACK_HOURS_SCHEMA = 24;        // schema-alarm (type B): toont ook de vorige piek op een weekdag
const CHART_LOOKAHEAD_HOURS = 6;               // klein beetje context na het alarm
const CHART_LOOKBACK_HOURS_PROBABILITY = 24;   // kansgrafiek: altijd 24u, los van het alarmtype-venster hierboven

function lookbackHoursForAlarmType(alarmType) {
  if (alarmType === 'B') return CHART_LOOKBACK_HOURS_SCHEMA;
  return CHART_LOOKBACK_HOURS_VIBRATION;
}

// Gebruikt anomaly_detection_result (niet vibration_10_min): dat resource bevat naast de
// effectieve meetwaarde ("value") ook normal_lower/normal_upper - de groene band uit de
// Soundsensing-app. Per device lopen er meerdere modellen tegelijk; enkel records met een
// gevulde band (het "Vibration Levels"-model) worden gebruikt. Die band toont zowel
// trilling-afwijkingen (lijn buiten de band) als schema-afwijkingen (vibratie blijft onder
// "normal lower" terwijl de band aangeeft dat de machine zou moeten draaien) - één grafiek
// volstaat dus voor beide alarmtypes, enkel het venster verschilt.
async function fetchVibrationHistory(deviceId, alarmTimestampUnix, lookbackHours) {
  const start = Math.floor(alarmTimestampUnix - lookbackHours * 3600);
  const end = Math.floor(alarmTimestampUnix + CHART_LOOKAHEAD_HOURS * 3600);
  const url = `${SOUNDSENSING_BASE_URL}/timeseries?resource=anomaly_detection_result&format=json&start=${start}&end=${end}&device=${deviceId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SOUNDSENSING_API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Soundsensing vibratie-historiek fout (${res.status}): ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .filter((item) => item.normal_lower != null && item.normal_upper != null)
    .map((item) => ({
      t: Number(item.end_time ?? 0),
      value: Number(item.value ?? 0),
      normalLower: Number(item.normal_lower),
      normalUpper: Number(item.normal_upper),
      probability: Number(item.probability ?? 0),
    }))
    .filter((p) => p.t > 0)
    .sort((a, b) => a.t - b.t);
}

function formatChartLabel(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString('nl-BE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const CHART_MAX_POINTS = 200; // quickchart loopt vast/timeout bij te veel punten (week aan 10-min data ~1000)

function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % step === 0);
}

async function buildVibrationChartPng(pointsIn, alarmTimestampUnix, title) {
  if (!pointsIn.length) return null;
  const points = downsample(pointsIn, CHART_MAX_POINTS);

  const labels = points.map((p) => formatChartLabel(p.t));
  const values = points.map((p) => Number(p.value.toFixed(4)));
  const normalLower = points.map((p) => Number(p.normalLower.toFixed(4)));
  const normalUpper = points.map((p) => Number(p.normalUpper.toFixed(4)));

  // Index van het datapunt het dichtst bij het alarm-tijdstip - gebruikt om een losse
  // markerstip te tonen op de lijn (geen plugin nodig, werkt met gewone Chart.js).
  let alarmIdx = 0;
  let smallestDiff = Infinity;
  points.forEach((p, i) => {
    const diff = Math.abs(p.t - alarmTimestampUnix);
    if (diff < smallestDiff) { smallestDiff = diff; alarmIdx = i; }
  });
  const alarmMarker = points.map((_, i) => (i === alarmIdx ? values[i] : null));

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Normal upper',
          data: normalUpper,
          borderColor: 'rgba(76,175,80,0.6)',
          backgroundColor: 'rgba(76,175,80,0.3)',
          borderWidth: 1,
          pointRadius: 0,
          fill: '+1', // vult tot dataset hierna (Normal lower) - vormt de groene band
          tension: 0,
        },
        {
          label: 'Normal lower',
          data: normalLower,
          borderColor: 'rgba(76,175,80,0.6)',
          backgroundColor: 'rgba(0,0,0,0)',
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
        {
          label: 'Vibratie',
          data: values,
          borderColor: '#000000',
          backgroundColor: 'rgba(0,0,0,0)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
        {
          label: 'Alarm',
          data: alarmMarker,
          borderColor: '#FF8C00',
          backgroundColor: '#FF8C00',
          pointRadius: 7,
          pointStyle: 'triangle',
          showLine: false,
        },
      ],
    },
    options: {
      title: { display: true, text: title },
      legend: { display: true, position: 'bottom' },
      scales: {
        xAxes: [{ ticks: { maxTicksLimit: 10, autoSkip: true } }],
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
    },
  };

  const res = await fetch(QUICKCHART_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: config, width: 900, height: 400, backgroundColor: 'white', format: 'png' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Quickchart fout (${res.status}): ${text.slice(0, 300)}`);
  }
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

// Tweede grafiek: het model rekent per datapunt een "probability" uit (kans dat dit punt een
// anomalie is) - die loopt vaak al naar 1.0 ruim vóór de meetwaarde zichtbaar buiten de groene
// band valt (bv. getest: kans=1.0 om 02:03 terwijl de waarde toen nog in de band lag, het echte
// alarm volgde pas om 03:00). Dat maakt deze grafiek een vroege-waarschuwingsindicator naast de
// vibratiewaarde zelf.
async function buildProbabilityChartPng(pointsIn, alarmTimestampUnix, title) {
  if (!pointsIn.length) return null;
  const points = downsample(pointsIn, CHART_MAX_POINTS);

  const labels = points.map((p) => formatChartLabel(p.t));
  const percentages = points.map((p) => Number(((p.probability ?? 0) * 100).toFixed(2)));

  let alarmIdx = 0;
  let smallestDiff = Infinity;
  points.forEach((p, i) => {
    const diff = Math.abs(p.t - alarmTimestampUnix);
    if (diff < smallestDiff) { smallestDiff = diff; alarmIdx = i; }
  });
  const alarmMarker = percentages.map((v, i) => (i === alarmIdx ? v : null));

  // Chart als JS-bronstring (niet als JSON-object) gestuurd naar quickchart - enkel dan
  // worden functies (de "%"-tick-callback) effectief uitgevoerd door hun renderer.
  const chartJsSource = `{
    type: 'line',
    data: {
      labels: ${JSON.stringify(labels)},
      datasets: [
        {
          label: 'Anomaliekans',
          data: ${JSON.stringify(percentages)},
          borderColor: '#1976D2',
          backgroundColor: 'rgba(25,118,210,0.15)',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          tension: 0,
        },
        {
          label: 'Alarm',
          data: ${JSON.stringify(alarmMarker)},
          borderColor: '#FF8C00',
          backgroundColor: '#FF8C00',
          pointRadius: 7,
          pointStyle: 'triangle',
          showLine: false,
        },
      ],
    },
    options: {
      title: { display: true, text: ${JSON.stringify(title)} },
      legend: { display: true, position: 'bottom' },
      scales: {
        xAxes: [{ ticks: { maxTicksLimit: 10, autoSkip: true } }],
        yAxes: [{ ticks: { beginAtZero: true, max: 100, callback: function(value) { return value + '%'; } } }],
      },
    },
  }`;

  const res = await fetch(QUICKCHART_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chart: chartJsSource, width: 900, height: 400, backgroundColor: 'white', format: 'png' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Quickchart fout (${res.status}): ${text.slice(0, 300)}`);
  }
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

async function attachJobDocument(ultimoBase, jobId, base64Png, fileName, description) {
  const url = `${ultimoBase}/action/${ACTION_QUERY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY,
      ApplicationElementId: APP_QUERY,
    },
    body: JSON.stringify({
      Action: 'ADD_JOB_DOC',
      JobId: jobId,
      AddDoc_FileName: fileName,
      AddDoc_Base64: base64Png,
      AddDoc_Description: description,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ultimo ADD_JOB_DOC fout (${res.status}): ${text.slice(0, 300)}`);
  }
  return true;
}

// === Handler =========================================================
export async function handler(event) {
  const { base: ULTIMO_BASE, label: ULTIMO_ENV_LABEL } = detectEnvironment(event);
  console.log(`[soundsensing-sync] Gestart - Ultimo env=${ULTIMO_ENV_LABEL}`);

  if (!SOUNDSENSING_API_KEY || !ULTIMO_API_KEY || !APP_QUERY || !APP_CREATE || !ULTIMO_BASE) {
    const msg = 'Misconfiguratie: env-variabelen ontbreken (SOUNDSENSING_API_KEY / ULTIMO_API_KEY / APP_ELEMENT_QueryAtalianJobs / APP_ELEMENT_OneAtalianJob / ULTIMO_API_BASEURL[_TEST]).';
    console.error(`[soundsensing-sync] ${msg}`);
    return { statusCode: 500, body: msg };
  }

  const state = await readState();
  const nowUnix = Math.floor(Date.now() / 1000);

  const startTime = nowUnix - LOOKBACK_SECONDS;

  let alarms = [];
  try {
    alarms = await fetchNewAlarms(startTime);
  } catch (err) {
    console.error('[soundsensing-sync] Fout bij ophalen alarmen:', err.message);
    return { statusCode: 502, body: `Fout bij ophalen alarmen: ${err.message}` };
  }

  console.log(`[soundsensing-sync] ${alarms.length} alarm(en) ontvangen sinds ${new Date(startTime * 1000).toISOString()}`);

  const processedIds = new Set((state.processedAlarms || []).map((p) => p.id));
  const newlyProcessed = [];
  let created = 0;
  let skippedDup = 0;
  let skippedNoMatch = 0;

  for (const alarm of alarms) {
    if (processedIds.has(alarm.id)) {
      skippedDup++;
      continue;
    }

    try {
      const equipment = await findEquipmentBySerial(ULTIMO_BASE, alarm.device_id);
      if (!equipment || !equipment.EquipmentId) {
        console.log(`[soundsensing-sync] Geen Ultimo-koppeling voor device_id=${alarm.device_id} (alarm ${alarm.id})`);
        skippedNoMatch++;
        continue; // niet als verwerkt markeren: opnieuw proberen zodra de koppeling in Ultimo staat (zit toch binnen het vaste terugblikvenster)
      }

      const { jobId } = await createUltimoJob(ULTIMO_BASE, equipment.EquipmentId, alarm.description, alarm.alarm_type);
      console.log(`[soundsensing-sync] Job aangemaakt voor EquipmentId=${equipment.EquipmentId} (alarm ${alarm.id}, jobId=${jobId})`);
      created++;
      newlyProcessed.push({ id: alarm.id, date: new Date().toISOString() });

      // Grafiek bijvoegen is best-effort: een fout hier mag de al aangemaakte job niet ongedaan maken.
      // Venster hangt af van het alarmtype: 12u (ingezoomd) voor schema-afwijkingen, 7 dagen voor trilling.
      if (jobId) {
        try {
          const alarmTimestamp = Number(alarm.timestamp || alarm.created_at);
          const titleBase = equipment.Description || equipment.EquipmentId;
          const lookbackHours = lookbackHoursForAlarmType(alarm.alarm_type);
          const vibration = await fetchVibrationHistory(alarm.device_id, alarmTimestamp, lookbackHours);

          const windowLabel = lookbackHours <= 24 ? `laatste ${lookbackHours} uur` : `laatste ${Math.round(lookbackHours / 24)} dagen`;

          const vibrationPng = await buildVibrationChartPng(vibration, alarmTimestamp, `${titleBase} - vibratiehistoriek (${alarmTypeLabel(alarm.alarm_type)})`);
          if (vibrationPng) {
            await attachJobDocument(ULTIMO_BASE, jobId, vibrationPng, 'vibratiehistoriek.png', `${titleBase} - Vibratiehistoriek (${windowLabel}) rond het alarm - Soundsensing`);
            console.log(`[soundsensing-sync] Vibratiegrafiek bijgevoegd aan job ${jobId} (${vibration.length} datapunten, venster=${lookbackHours}u)`);
          } else {
            console.log(`[soundsensing-sync] Geen vibratiedata gevonden voor device_id=${alarm.device_id}`);
          }

          // De kansgrafiek krijgt een eigen, kortere venster (24u): de "probability" is meestal
          // een stapfunctie die de rest van het 7-dagen-venster gewoon op 0 blijft staan - inzoomen
          // op de laatste 24u rond het alarm toont de eigenlijke vroege-waarschuwing veel duidelijker.
          const probabilityWindowPoints = vibration.filter((p) => p.t >= alarmTimestamp - CHART_LOOKBACK_HOURS_PROBABILITY * 3600);
          const probabilityWindowLabel = `laatste ${CHART_LOOKBACK_HOURS_PROBABILITY} uur`;
          const probabilityPng = await buildProbabilityChartPng(probabilityWindowPoints, alarmTimestamp, `${titleBase} - anomaliekans (${alarmTypeLabel(alarm.alarm_type)})`);
          if (probabilityPng) {
            await attachJobDocument(ULTIMO_BASE, jobId, probabilityPng, 'anomaliekans.png', `${titleBase} - Anomaliekans (${probabilityWindowLabel}) rond het alarm - vroege-waarschuwingsindicator van het model - Soundsensing`);
            console.log(`[soundsensing-sync] Kansgrafiek bijgevoegd aan job ${jobId}`);
          }
        } catch (chartErr) {
          console.error(`[soundsensing-sync] Grafiek/bijlage mislukt voor job ${jobId} (alarm ${alarm.id}):`, chartErr.message);
        }
      }
    } catch (err) {
      console.error(`[soundsensing-sync] Fout bij verwerken alarm ${alarm.id}:`, err.message);
      // niet als verwerkt markeren: zit toch binnen het vaste terugblikvenster, dus volgende run opnieuw geprobeerd
    }
  }

  // Opschonen: verwerkte alarm-IDs ouder dan 90 dagen verwijderen
  const cutoff = Date.now() - PROCESSED_MAX_AGE_DAYS * 24 * 3600 * 1000;
  const prunedProcessed = (state.processedAlarms || []).filter((p) => new Date(p.date).getTime() > cutoff);

  // lastCheck is enkel informatief (laatste run-tijdstip) - het venster zelf is altijd vast
  // (LOOKBACK_SECONDS), dus dit stuurt niets meer aan.
  const newState = {
    lastCheck: nowUnix,
    processedAlarms: [...prunedProcessed, ...newlyProcessed],
  };
  await writeState(newState);

  const summary = `Klaar: ${alarms.length} alarmen, ${created} job(s) aangemaakt, ${skippedDup} duplicaten overgeslagen, ${skippedNoMatch} zonder Ultimo-koppeling.`;
  console.log(`[soundsensing-sync] ${summary}`);

  return { statusCode: 200, body: summary };
}
