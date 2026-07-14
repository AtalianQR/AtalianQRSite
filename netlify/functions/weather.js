// netlify/functions/weather.js
// Endpoint dat weer + gebouwdata samenvoegt uit één RealPulse-asset-call. De parsing is opgesplitst:
//   - lib/weather.js   : buitentemp/vochtigheid (asset) + Open-Meteo forecast  → publiek
//   - lib/occupancy.js : bezettingsgraad + energie (zelfde asset)              → tier-gated
// Ultimo = master; asset-id/plaats zijn defaults voor de demo en later uit de complex-content
// (companion.json) te halen (?asset=&lat=&lon=&place= override).
//
// Privacy-tiering (zie lib/tier.js): het weer zelf (buitentemp + forecast) is publieke info en
// blijft altijd zichtbaar. Het ENERGIEVERBRUIK en de BEZETTINGSGRAAD van het gebouw zijn
// bedrijfsgevoelig (verraden wanneer het gebouw leeg staat) en komen enkel mee voor bezoekers
// op het interne kantoornetwerk. Vereist daarvoor ?spaceId= zodat de wifi-CIDR's opzoekbaar zijn.
/* eslint-disable */
import { resolveSpaceTier } from './lib/tier.js';
import { collectWeather, forecastFromOpenMeteo } from './lib/weather.js';
import { parseOccupancy, DESK_TOTAL, MEETING_TOTAL } from './lib/occupancy.js';

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
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra },
  body: JSON.stringify(obj),
});

// Eén RealPulse-call; null = asset onbeschikbaar (geen creds / niet-ok response).
async function fetchAsset(assetId) {
  if (!REALPULSE_USER || !REALPULSE_PASS) return null;
  const auth = 'Basic ' + Buffer.from(`${REALPULSE_USER}:${REALPULSE_PASS}`).toString('base64');
  const res = await fetch(`${REALPULSE_BASE}/api/assets/${assetId}`, { headers: { Authorization: auth, accept: 'application/json' } });
  if (!res.ok) return null;
  return await res.json().catch(() => ({}));
}

// Combineert buitentemp (weer) + bezetting/energie uit dezelfde asset-JSON.
async function outdoorFromRealpulse(assetId, deskTotal = DESK_TOTAL, meetingTotal = MEETING_TOTAL, debug = false) {
  const asset = await fetchAsset(assetId);
  if (!asset) return {};
  const w = collectWeather(asset);
  const { occupancy, energy, occupancyDebug } = parseOccupancy(asset, { deskTotal, meetingTotal, debug });
  return {
    temp: w.temperature ?? null,
    hum: w.humidity ?? null,
    occupancy,
    energy,
    ...(debug ? { occupancyDebug } : {}),
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  const qs = event.queryStringParameters || {};
  const assetId = String(qs.asset || DEFAULT_ASSET);
  const place = String(qs.place || DEFAULT_PLACE);
  const spaceId = String(qs.spaceId || qs.id || '').trim();
  const debug = qs.debug === '1' || qs.debug === 'true';
  const deskTotal = Number(qs.deskTotal) || DESK_TOTAL;
  const meetingTotal = Number(qs.meetingTotal) || MEETING_TOTAL;

  try {
    // Tier + netwerken (incl. gebouwcoördinaten GeocodeX/Y). Faalt veilig naar 'public'.
    const { tier, ip, networks } = await resolveSpaceTier(event, { base: detectBase(event), spaceId, apiKey: ULTIMO_API_KEY, appQuery: APP_QUERY });

    // Coördinaten voor de forecast: gebouw (Ultimo) > ?lat/lon= > Anderlecht-default.
    const lat = (networks && networks.lat != null ? networks.lat : (qs.lat || DEFAULT_LAT));
    const lon = (networks && networks.lon != null ? networks.lon : (qs.lon || DEFAULT_LON));

    const [outdoor, fc] = await Promise.all([outdoorFromRealpulse(assetId, deskTotal, meetingTotal, debug), forecastFromOpenMeteo(lat, lon)]);
    return json(200, {
      place,
      now: { temp: outdoor.temp, hum: outdoor.hum, code: fc.code }, // weer = altijd publiek
      forecast: fc.forecast,
      // Gebouw-brede data: intern ziet alles; gast enkel het drukte-NIVEAU (rate, geen cijfers);
      // publiek niets. Energie (kWh) blijft strikt intern.
      ...(tier === 'internal' ? {
        occupancy: outdoor.occupancy ?? null, // {people, deskRate, deskCount, meetingRate, meetingCount, rate}
        energy: outdoor.energy ?? null,
      } : tier === 'guest' ? {
        occupancy: { rate: outdoor.occupancy ? (outdoor.occupancy.rate ?? null) : null }, // enkel niveau
      } : {}),
      tier,
      // Debug-internals (ip, coördinaten) enkel voor tier 'internal' (kantoornet/lokaal), nooit publiek.
      ...(debug && tier === 'internal' ? {
        spaceId,
        ip,
        lat,
        lon,
        coordSource: (networks && networks.lat != null) ? 'building' : 'default',
        occupancyDebug: outdoor.occupancyDebug ?? null,
      } : {}),
    });
  } catch (err) {
    console.error('[weather] fout:', err.message);
    return json(200, { place, now: { temp: null }, forecast: [] });
  }
}
