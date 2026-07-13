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

async function outdoorFromRealpulse(assetId, deskTotal = DESK_TOTAL, meetingTotal = MEETING_TOTAL, debug = false) {
  if (!REALPULSE_USER || !REALPULSE_PASS) return {};
  const auth = 'Basic ' + Buffer.from(`${REALPULSE_USER}:${REALPULSE_PASS}`).toString('base64');
  const res = await fetch(`${REALPULSE_BASE}/api/assets/${assetId}`, { headers: { Authorization: auth, accept: 'application/json' } });
  if (!res.ok) return {};
  const a = await res.json().catch(() => ({}));
  const w = collectWeather(a);
  // Drukte = drie complementaire signalen uit RealPulse (gebouw-breed):
  //   - people:  Admin + Private unit People counter — hoeveel mensen NU aanwezig
  //   - desk:    werkplek-bezetting (rate % + absoluut aantal) — hoe vol de kantoortuin zit
  //   - meeting: vergaderzaal-bezetting (rate % + aantal) — overleg-activiteit
  // Het NIVEAU (rustig/gemiddeld/druk) leiden we af uit de desk-graad (zelf-genormaliseerd).
  // RealPulse telt Occupied (desks/MR) correct; het totaal ("Availability" op het dashboard) zit
  // niet in de meetdata → dat is de vaste gebouwconstante. We tonen dus count/totaal (bv. 1/6).
  const last = Array.isArray(a?.last) ? a.last : [];
  const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const num = (row) => {
    const values = [
      row?.value,
      row?.measurement?.value,
      row?.lastValue,
      row?.currentValue,
      row?.current,
      row?.current?.value,
      row?.count,
      row?.latest?.value,
      row?.last?.value,
      row?.state?.value,
      row?.input?.value,
      row?.data?.value,
      row?.data?.measurement?.value,
      row?.result?.value,
    ];
    for (const value of values) {
      if (value == null || value === '') continue;
      const text = String(value).replace(',', '.').replace('%', '').trim();
      const n = Number(text);
      if (Number.isFinite(n)) return n;
      const m = text.match(/^-?\d+(\.\d+)?/);
      if (m) {
        const parsed = Number(m[0]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  };
  const metricText = (row) => norm([
    row?.label,
    row?.name,
    row?.title,
    row?.column,
    row?.metric,
    row?.type,
    row?.unit,
    typeof row?.measurement === 'string' ? row.measurement : '',
    row?.measurement?.type,
    row?.measurement?.name,
    row?.measurement?.label,
    row?.measurement?.description,
    row?.measurement?.unit,
    row?.measurementType,
    row?.measurementName,
    row?.measure,
    row?.measureName,
  ].join(' '));
  const deviceText = (row) => norm([
    row?.deviceName,
    row?.device?.name,
    row?.assetName,
    row?.asset?.name,
    row?.object,
    row?.kind,
    row?.input?.name,
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
  const ownText = (row) => norm([
    row?.label,
    row?.name,
    row?.title,
    row?.column,
    row?.metric,
    row?.type,
    row?.unit,
    row?.kind,
    row?.object,
    row?.assetName,
    row?.deviceName,
    row?.group,
    row?.groupName,
    row?.labelAggregation,
    typeof row?.measurement === 'string' ? row.measurement : '',
    row?.measurement?.type,
    row?.measurement?.name,
    row?.measurement?.label,
    row?.measurement?.description,
    row?.measurementType,
    row?.measurementName,
  ].join(' '));
  const sourcePreview = (row, path, extra = {}) => ({
    path,
    value: num(row),
    keys: Object.keys(row || {}).slice(0, 16),
    name: row?.name ?? row?.deviceName ?? row?.assetName ?? row?.object ?? row?.input?.name ?? null,
    type: row?.type ?? row?.kind ?? null,
    measurement: debugMeasurement(row) || null,
    text: ownText(row).slice(0, 220),
    ...extra,
  });
  const collectPeopleSources = () => {
    const sources = [];
    const seen = new Set();
    const add = (row, path) => {
      if (!row || typeof row !== 'object' || seen.has(row)) return;
      seen.add(row);
      sources.push({ row, path });
    };
    last.forEach((row, index) => add(row, `last.${index}`));
    (function walk(o, path = 'asset') {
      if (Array.isArray(o)) {
        o.forEach((item, index) => walk(item, `${path}.${index}`));
        return;
      }
      if (!o || typeof o !== 'object') return;
      const text = `${ownText(o)} ${allText(o)}`;
      if (
        /\b(admin|private|admin unit|private unit)\b/.test(text) &&
        /\bpeople counter\b|\bcounter people\b|\bpeople\b|\bpersons?\b|\bpersonen\b|\bpers\b/.test(text)
      ) add(o, path);
      for (const key in o) walk(o[key], `${path}.${key}`);
    })(a);
    return sources;
  };
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
  const peopleSources = collectPeopleSources();
  const peopleDebug = [];
  const debugMeasurement = (row) => (
    typeof row?.measurement === 'string'
      ? row.measurement
      : (row?.measurement?.type || row?.measurement?.name || row?.measurement?.label || '')
  );
  const rememberPeopleDebug = (hit) => {
    if (!debug || peopleDebug.length >= 30) return;
    const row = hit.row;
    peopleDebug.push(sourcePreview(row, hit.path, {
      key: hit.key,
      accepted: hit.accepted,
      score: hit.score,
      label: row?.label ?? null,
    }));
  };
  const peopleCount = () => {
    const unitRows = new Map();
    for (const source of peopleSources) {
      const row = source.row;
      const value = num(row);

      const d = deviceText(row);
      const m = metricText(row);
      const t = allText(row);
      const nameText = norm([
        row?.name,
        row?.deviceName,
        row?.device?.name,
        row?.assetName,
        row?.asset?.name,
        row?.object,
        row?.kind,
        row?.input?.name,
        row?.input?.label,
        row?.group,
        row?.groupName,
        row?.labelAggregation,
      ].join(' '));
      const sourceText = [d, m, nameText, t].join(' ');
      const peopleSignal = /\bpeople counter\b|\bcounter people\b|\bpeople\b|\bpersons?\b|\bpersonen\b|\bpers\b/.test(sourceText);
      const peopleCounter = /\bpeople counter\b|\bcounter people\b/.test(sourceText);

      const admin =
        /\badmin unit\b/.test(sourceText) ||
        (peopleSignal && /\badmin\b/.test(nameText) && !/\barea admin\b|\bkitchen admin\b/.test(nameText));
      const priv =
        /\bprivate unit\b/.test(sourceText) ||
        (peopleSignal && /\bprivate\b/.test(nameText) && !/\bkitchen private\b/.test(nameText));
      if (admin === priv) {
        if (debug && /\badmin\b|\bprivate\b|\bpeople\b/.test(sourceText)) {
          rememberPeopleDebug({ row, path: source.path, key: null, accepted: false, score: 0 });
        }
        continue;
      }
      const key = admin ? 'admin' : priv ? 'private' : null;
      if (!key) continue;

      const unitLabel = new RegExp(`\\b${key} unit\\b`).test(sourceText);
      const wrongMetric = /\bavailability\b|\bavailable\b|\btotal\b|\brate\b|\bdesk\b|\bdesks\b|\bmeeting rooms?\b|\bmr\b/.test(m);
      if (wrongMetric || (!unitLabel && !peopleSignal)) {
        rememberPeopleDebug({ row, path: source.path, key, accepted: false, score: 0 });
        continue;
      }

      const prev = unitRows.get(key);
      let score = 0;
      if (value != null) score += 1000;
      if (peopleCounter) score += 100;
      if (nameText === key) score += 80;
      if (new RegExp(`\\b${key}\\b`).test(nameText)) score += 40;
      if (unitLabel) score += 20;
      if (/\bpeople in\b/.test(sourceText)) score += 10;
      rememberPeopleDebug({ row, path: source.path, key, accepted: true, score });
      if (!prev || score > prev.score || (score === prev.score && ts(row) > ts(prev.row))) {
        unitRows.set(key, { row, score, path: source.path });
      }
    }
    if (unitRows.size) {
      const admin = unitRows.get('admin');
      const priv = unitRows.get('private');
      return (num(admin?.row) ?? 0) + (num(priv?.row) ?? 0);
    }
    return null;
  };
  const countFromRate = (rate, total) => (
    rate != null && total != null ? Math.round((Number(rate) / 100) * Number(total)) : null
  );
  const deskRate = aggregateMetric('desk', 'rate');
  const deskCount = aggregateMetric('desk', 'count') ?? countFromRate(deskRate, deskTotal);
  const meetingCount = aggregateMetric('meeting', 'count');
  const derivedDeskRate = deskRate != null
    ? deskRate
    : (deskCount != null && deskTotal ? (Number(deskCount) / Number(deskTotal)) * 100 : null);
  const derivedMeetingRate = meetingCount != null && meetingTotal
    ? (Number(meetingCount) / Number(meetingTotal)) * 100
    : null;
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
  occupancy.rate = derivedDeskRate != null ? derivedDeskRate : derivedMeetingRate;

  // Energie (elektriciteitsverbruik) van het gebouw — deltas uit de Elec-meter.
  const daily = last.find((x) => x && x.type === 'Elec (daily delta)');
  const hourly = last.find((x) => x && x.type === 'Elec (hourly delta)');
  const yearly = last.find((x) => x && x.type === 'Elec (yearly delta)');
  const energy = {
    daily: daily ? Number(daily.value) : null,
    hourly: hourly ? Number(hourly.value) : null,
    yearly: yearly ? Number(yearly.value) : null,
  };

  return {
    temp: w.temperature ?? null,
    hum: w.humidity ?? null,
    occupancy,
    energy,
    ...(debug ? {
      occupancyDebug: {
        peopleSourceCount: peopleSources.length,
        peopleSources: peopleSources.slice(0, 50).map((source) => sourcePreview(source.row, source.path)),
        peopleCandidates: peopleDebug,
      },
    } : {}),
  };
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
