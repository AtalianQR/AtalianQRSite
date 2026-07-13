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

// Totaal aantal desks/vergaderzalen = statische gebouwfeiten (Anderlecht: 30 desks, 6 zalen).
// De asset geeft dit niet betrouwbaar terug (deling count/graad wisselt), dus zetten we het vast en
// leiden het AANTAL af uit de betrouwbare bezettingsgraad (rate × totaal). Overschrijfbaar via
// ?deskTotal=&meetingTotal= (later ideaal een gebouwkenmerk in Ultimo).
const DESK_TOTAL = 30, MEETING_TOTAL = 6;

const json = (status, obj = {}, extra = {}) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra },
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

async function outdoorFromRealpulse(assetId, deskTotal = DESK_TOTAL, meetingTotal = MEETING_TOTAL) {
  if (!REALPULSE_USER || !REALPULSE_PASS) return {};
  const auth = 'Basic ' + Buffer.from(`${REALPULSE_USER}:${REALPULSE_PASS}`).toString('base64');
  const res = await fetch(`${REALPULSE_BASE}/api/assets/${assetId}`, { headers: { Authorization: auth, accept: 'application/json' } });
  if (!res.ok) return {};
  const a = await res.json().catch(() => ({}));
  const w = collectWeather(a);
  // Drukte = drie complementaire signalen uit RealPulse (gebouw-breed):
  //   - people:  live headcount ("People - Anderlecht", counter/people) — hoeveel mensen NU aanwezig
  //   - desk:    werkplek-bezetting (rate % + absoluut aantal) — hoe vol de kantoortuin zit
  //   - meeting: vergaderzaal-bezetting (rate % + aantal) — overleg-activiteit
  // Het NIVEAU (rustig/gemiddeld/druk) leiden we af uit de desk-graad (zelf-genormaliseerd).
  // RealPulse telt Occupied (desks/MR) correct; het totaal ("Availability" op het dashboard) zit
  // niet in de meetdata → dat is de vaste gebouwconstante. We tonen dus count/totaal (bv. 1/6).
  const last = Array.isArray(a?.last) ? a.last : [];
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const num = (row) => {
    const n = Number(row?.value);
    return Number.isFinite(n) ? n : null;
  };
  const metricText = (row) => norm([
    row?.label,
    row?.name,
    row?.title,
    row?.column,
    row?.metric,
    row?.type,
    row?.unit,
    row?.measurement?.type,
    row?.measurement?.unit,
  ].join(' '));
  const deviceText = (row) => norm([
    row?.deviceName,
    row?.device?.name,
    row?.name,
    row?.group,
    row?.groupName,
    row?.labelAggregation,
  ].join(' '));
  const allText = (row) => norm(JSON.stringify(row ?? {}));
  const ts = (row) => {
    const t = new Date(row?.timestamp ?? row?.date ?? 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const latest = (rows) => rows
    .filter((row) => num(row) != null)
    .sort((a, b) => ts(b) - ts(a))[0] || null;
  const aggregateMetric = (kind, metric) => {
    const isMeeting = kind === 'meeting';
    const isDesk = kind === 'desk';
    const candidates = last.map((row) => {
      const d = deviceText(row);
      const m = metricText(row);
      const t = allText(row);

      const deviceOk = isMeeting
        ? d === 'mr' || d === 'meeting rooms' || d === 'meeting room' || /\bmeeting rooms?\b/.test(d) || (/\bmr\b/.test(d) && !/\bmr [a-z0-9]+/.test(d))
        : isDesk
          ? d === 'desks' || d === 'desk' || /\bdesks?\b/.test(d)
          : false;

      const looseDeviceOk = isMeeting ? /\bmeeting rooms?\b|\bmr\b/.test(t) : /\bdesks?\b/.test(t);
      const metricOk = metric === 'rate'
        ? /\boccupancy rate\b|\brate\b/.test(m) && !/\bavailability\b|\bavailable\b|\btotal\b/.test(m)
        : /\boccupied\b/.test(m) && !/\brate\b|\bavailability\b|\bavailable\b|\btotal\b/.test(m);

      if (!metricOk || !(deviceOk || looseDeviceOk)) return null;

      let score = 0;
      if (isMeeting && (d === 'mr' || d === 'meeting rooms')) score += 80;
      if (isDesk && (d === 'desk' || d === 'desks')) score += 80;
      if (deviceOk) score += 30;
      if (metric === 'rate' && /\boccupancy rate\b/.test(m)) score += 40;
      if (metric === 'count' && m === 'occupied') score += 40;
      return { row, score };
    }).filter(Boolean);
    candidates.sort((a, b) => (b.score - a.score) || (ts(b.row) - ts(a.row)));
    return num(candidates[0]?.row);
  };
  const peopleCount = () => {
    const unitRows = new Map();
    for (const row of last) {
      const value = num(row);
      if (value == null) continue;

      const d = deviceText(row);
      const m = metricText(row);
      const t = allText(row);

      const admin = /\badmin unit\b/.test(d) || (/\badmin unit\b/.test(t) && !/\bprivate unit\b/.test(t));
      const priv = /\bprivate unit\b/.test(d) || (/\bprivate unit\b/.test(t) && !/\badmin unit\b/.test(t));
      const key = admin ? 'admin' : priv ? 'private' : null;
      if (!key) continue;

      const signalOk =
        d === `${key} unit` ||
        /\bpeople counter\b|\bcounter people\b/.test(m) ||
        /\bpeople\b|\bpersons?\b|\bpersonen\b|\bpers\b/.test(m);
      const wrongMetric = /\bavailability\b|\bavailable\b|\btotal\b|\brate\b|\bdesk\b|\bdesks\b|\bmeeting rooms?\b|\bmr\b/.test(m);
      if (!signalOk || wrongMetric) continue;

      const prev = unitRows.get(key);
      if (!prev || ts(row) > ts(prev)) unitRows.set(key, row);
    }
    if (unitRows.size) {
      return [...unitRows.values()].reduce((sum, row) => sum + (num(row) ?? 0), 0);
    }

    const candidates = last.map((row) => {
      const m = metricText(row);
      const t = allText(row);
      if (num(row) == null) return null;
      let score = 0;
      if (/\bpeople counter\b|\bcounter people\b/.test(m) || /\bpeople counter\b|\bcounter people\b/.test(t)) score += 50;
      if (/\bpeople\b|\bpersons?\b|\bpersonen\b|\bpers\b/.test(m)) score += 25;
      if (score <= 0) return null;
      return { row, score };
    }).filter(Boolean);
    candidates.sort((a, b) => (b.score - a.score) || (ts(b.row) - ts(a.row)));
    return num(candidates[0]?.row);
  };
  const countFromRate = (rate, total) => (
    rate != null && total != null ? Math.round((Number(rate) / 100) * Number(total)) : null
  );
  const deskRate = aggregateMetric('desk', 'rate');
  const deskCount = aggregateMetric('desk', 'count') ?? countFromRate(deskRate, deskTotal);
  const meetingCount = aggregateMetric('meeting', 'count');
  const occupancy = {
    people:       peopleCount(),
    deskRate,
    deskCount,
    deskTotal:    deskTotal,
    meetingRate:  null,
    meetingCount,
    meetingTotal: meetingTotal,
  };
  // rate = het niveau-bepalende signaal (desk-graad; fallback meeting-graad als desks ontbreken).
  occupancy.rate = occupancy.deskRate != null ? occupancy.deskRate : occupancy.meetingRate;

  // Energie (elektriciteitsverbruik) van het gebouw — deltas uit de Elec-meter.
  const daily = last.find((x) => x && x.type === 'Elec (daily delta)');
  const hourly = last.find((x) => x && x.type === 'Elec (hourly delta)');
  const yearly = last.find((x) => x && x.type === 'Elec (yearly delta)');
  const energy = {
    daily: daily ? Number(daily.value) : null,
    hourly: hourly ? Number(hourly.value) : null,
    yearly: yearly ? Number(yearly.value) : null,
  };

  return { temp: w.temperature ?? null, hum: w.humidity ?? null, occupancy, energy };
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

    const [outdoor, fc] = await Promise.all([outdoorFromRealpulse(assetId, deskTotal, meetingTotal), forecastFromOpenMeteo(lat, lon)]);
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
      ...(debug && tier === 'internal' ? { spaceId, ip, lat, lon, coordSource: (networks && networks.lat != null) ? 'building' : 'default' } : {}),
    });
  } catch (err) {
    console.error('[weather] fout:', err.message);
    return json(200, { place, now: { temp: null }, forecast: [] });
  }
}
