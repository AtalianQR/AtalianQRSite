// netlify/functions/weather.js
// Weerkaart: huidige BUITENtemperatuur uit de RealPulse WEATHER-asset ("eigen sensor") +
// uurforecast van Open-Meteo (een sensor voorspelt niet). Ultimo = master; asset-id/plaats
// zijn defaults voor de demo en later uit de complex-content (companion.json) te halen
// (?asset=&lat=&lon=&place= override).
/* eslint-disable */

const REALPULSE_USER = process.env.REALPULSE_USER;
const REALPULSE_PASS = process.env.REALPULSE_PASS;
const REALPULSE_BASE = process.env.REALPULSE_BASEURL || 'https://report.iotfactory.eu';

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
  // Gebouw-brede bezettingsgraad: max van de occupancy-rate-metingen (Desk/Meeting room occupancy rate,
  // unit %). Betrouwbaarder dan de deurteller-headcount (die geeft footfall, geen netto-aanwezigheid).
  const last = Array.isArray(a?.last) ? a.last : [];
  const rates = last
    .filter((x) => x && x.unit === '%' && (/ccupanc/i.test(x.type || '') || /occupanc/i.test(x.deviceName || '')))
    .map((x) => Number(x.value)).filter((v) => !Number.isNaN(v));
  const occupancyRate = rates.length ? Math.max(...rates) : null;
  return { temp: w.temperature ?? null, hum: w.humidity ?? null, occupancyRate };
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

  try {
    const [outdoor, fc] = await Promise.all([outdoorFromRealpulse(assetId), forecastFromOpenMeteo(lat, lon)]);
    return json(200, {
      place,
      now: { temp: outdoor.temp, hum: outdoor.hum, code: fc.code },
      forecast: fc.forecast,
      occupancy: { rate: outdoor.occupancyRate ?? null }, // gebouw-brede bezettingsgraad %
    });
  } catch (err) {
    console.error('[weather] fout:', err.message);
    return json(200, { place, now: { temp: null }, forecast: [] });
  }
}
