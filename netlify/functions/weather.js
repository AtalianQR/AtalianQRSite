// netlify/functions/weather.js
// Weerkaart: huidige BUITENtemperatuur uit de RealPulse WEATHER-asset ("eigen sensor") +
// uurforecast van Open-Meteo (een sensor voorspelt niet). Ultimo = master; asset-id/plaats
// zijn defaults voor de demo en later uit de complex-content (companion.json) te halen
// (?asset=&lat=&lon=&place= override).
//
// Privacy-tiering (zie lib/tier.js): het weer zelf (buitentemp + forecast) is publieke info en
// blijft altijd zichtbaar. Het ENERGIEVERBRUIK en de BEZETTINGSGRAAD van het gebouw zijn
// bedrijfsgevoelig (verraden wanneer het gebouw leeg staat) en komen enkel mee voor bezoekers
// op het interne kantoornetwerk. Vereist daarvoor ?spaceId= zodat de wifi-CIDR's opzoekbaar zijn.
/* eslint-disable */
import { resolveSpaceTier } from './lib/tier.js';

const REALPULSE_USER = process.env.REALPULSE_USER;
const REALPULSE_PASS = process.env.REALPULSE_PASS;
const REALPULSE_BASE = process.env.REALPULSE_BASEURL || 'https://report.iotfactory.eu';

// Ultimo (voor de tier-lookup; zelfde env als room.js/space.js).
const ULTIMO_API_KEY   = process.env.ULTIMO_API_KEY;
const ULTIMO_BASE_PROD = process.env.ULTIMO_API_BASEURL;
const ULTIMO_BASE_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_QUERY        = process.env.APP_ELEMENT_QueryAtalianJobs;

function detectBase(event = {}) {
  const qs = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';
  const isTest = qs.test === '1' || qs.test === 'true' || qs.env === 'test' || /test|staging/i.test(host);
  return isTest ? ULTIMO_BASE_TEST : ULTIMO_BASE_PROD;
}

const DEFAULT_ASSET = '66fd4b46bcb30600213e90aa'; // "Atalian - Anderlecht" WEATHER-asset
const DEFAULT_LAT = 50.8333, DEFAULT_LON = 4.3167, DEFAULT_PLACE = 'Anderlecht';

const json = (status, obj = {}, extra = {}) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300', ...extra },
  body: JSON.stringify(obj),
});

// Verzamel alle Weather-metingen (temperature/humidity/…) ongeacht hun pad in de asset-JSON.
function collectWeather(obj) {
  const out = {};
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (o.dataSource === 'Weather' && o.measurement && o.measurement.type) {
        out[o.measurement.type] = o.measurement.value;
      }
      for (const k in o) walk(o[k]);
    }
  })(obj);
  return out;
}

async function outdoorFromRealpulse(assetId) {
  if (!REALPULSE_USER || !REALPULSE_PASS) return {};
  const auth = 'Basic ' + Buffer.from(`${REALPULSE_USER}:${REALPULSE_PASS}`).toString('base64');
  const res = await fetch(`${REALPULSE_BASE}/api/assets/${assetId}`, { headers: { Authorization: auth, accept: 'application/json' } });
  if (!res.ok) return {};
  const a = await res.json().catch(() => ({}));
  const w = collectWeather(a);
  // Bezettingsgraad van de VERGADERZALEN (Meeting room occupancy rate, %). Realistisch tot ~85% (6/7);
  // betrouwbaarder dan de deurteller-headcount (footfall). Fallback: eender welke occupancy-% als de
  // meeting-room-meting even ontbreekt.
  const last = Array.isArray(a?.last) ? a.last : [];
  const pct = last.filter((x) => x && x.unit === '%' && (/ccupanc/i.test(x.type || '') || /occupanc/i.test(x.deviceName || '')));
  const mr = pct.find((x) => /meeting\s*room/i.test(x.deviceName || ''));
  const occupancyRate = mr ? Number(mr.value) : (pct.length ? Number(pct[0].value) : null);

  // Energie (elektriciteitsverbruik) van het gebouw — deltas uit de Elec-meter.
  const daily = last.find((x) => x && x.type === 'Elec (daily delta)');
  const hourly = last.find((x) => x && x.type === 'Elec (hourly delta)');
  const yearly = last.find((x) => x && x.type === 'Elec (yearly delta)');
  const energy = {
    daily: daily ? Number(daily.value) : null,
    hourly: hourly ? Number(hourly.value) : null,
    yearly: yearly ? Number(yearly.value) : null,
  };

  return { temp: w.temperature ?? null, hum: w.humidity ?? null, occupancyRate, energy };
}

async function forecastFromOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code&hourly=temperature_2m,weather_code&timezone=Europe%2FBrussels&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) return { code: null, forecast: [] };
  const d = await res.json().catch(() => ({}));
  const times = d?.hourly?.time || [];
  const temps = d?.hourly?.temperature_2m || [];
  const codes = d?.hourly?.weather_code || [];
  const now = Date.now();
  let start = times.findIndex((t) => new Date(t).getTime() > now);
  if (start < 0) start = 0;
  const forecast = [];
  for (const step of [2, 4, 6]) { // +2u/+4u/+6u, zoals de mockup (14u/16u/18u)
    const i = start + step;
    if (i < times.length) forecast.push({ hour: new Date(times[i]).getHours(), temp: Math.round(temps[i]), code: codes[i] });
  }
  return { code: d?.current?.weather_code ?? null, forecast };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  const qs = event.queryStringParameters || {};
  const assetId = String(qs.asset || DEFAULT_ASSET);
  const lat = qs.lat || DEFAULT_LAT, lon = qs.lon || DEFAULT_LON;
  const place = String(qs.place || DEFAULT_PLACE);
  const spaceId = String(qs.spaceId || qs.id || '').trim();
  const debug = qs.debug === '1' || qs.debug === 'true';

  try {
    // Tier bepalen (faalt veilig naar 'public'). Zonder spaceId → publiek → geen energie/bezetting.
    const { tier, ip } = await resolveSpaceTier(event, { base: detectBase(event), spaceId, apiKey: ULTIMO_API_KEY, appQuery: APP_QUERY });

    const [outdoor, fc] = await Promise.all([outdoorFromRealpulse(assetId), forecastFromOpenMeteo(lat, lon)]);
    return json(200, {
      place,
      now: { temp: outdoor.temp, hum: outdoor.hum, code: fc.code }, // weer = altijd publiek
      forecast: fc.forecast,
      // Gebouw-brede bezetting + energie: bedrijfsgevoelig → enkel op het interne netwerk.
      ...(tier === 'internal' ? {
        occupancy: { rate: outdoor.occupancyRate ?? null },
        energy: outdoor.energy ?? null,
      } : {}),
      tier,
      ...(debug ? { spaceId, ip } : {}),
    });
  } catch (err) {
    console.error('[weather] fout:', err.message);
    return json(200, { place, now: { temp: null }, forecast: [] });
  }
}
