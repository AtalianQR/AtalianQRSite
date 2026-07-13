// netlify/functions/room.js
// Companion sensordata-proxy (keuze A uit docs/2026-07-11-companion-mode-ultimo-vlag-design.md).
//
// Ultimo = master, de *.js zijn slaves. De browser stuurt enkel ?spaceId=&lang=&env=.
// Deze functie:
//   1) haalt via de Query-WFL de KENMERKEN (ObjectFeatures) van de Space op (description + waarde)
//   2) ROUTEERT op basis van de feature-description naar het juiste bronsysteem
//        - description bevat "iot"  → RealPulse (report.iotfactory.eu), waarde = asset-id
//        (installaties krijgen later analoog een "soundsensing"-route)
//   3) haalt server-side de sensordata op en geeft gesaneerde JSON terug
//
// Geen asset-id en geen credentials in het antwoord (behalve met ?debug=1, enkel voor
// ontwikkeling: dan echo't het ook welk kenmerk matchte en de resolved id).
//
// Privacy-tiering (zie lib/tier.js): wie NIET op het kantoornetwerk zit (publiek IP buiten de
// wifi-CIDR's uit Ultimo) krijgt enkel een LIGHT-versie zonder exacte meetwaarden. Op het
// gastnetwerk komen de comfortcijfers wel mee, maar geen bezetting/aanwezigen; enkel intern
// ziet alles. De redactie gebeurt hier server-side, nooit in de browser.
/* eslint-disable */
import { resolveSpaceTier } from './lib/tier.js';

// CO2 → kwalitatief comfortlabel (voor de light-versie; frontend vertaalt de key).
function comfortKey(co2) {
  if (co2 == null || isNaN(co2)) return null;
  if (Number(co2) < 900)  return 'good';
  if (Number(co2) <= 1200) return 'ok';
  return 'poor';
}

// === ENV: Ultimo =====================================================
const ULTIMO_API_KEY   = process.env.ULTIMO_API_KEY;
const ULTIMO_BASE_PROD = process.env.ULTIMO_API_BASEURL;
const ULTIMO_BASE_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;
const APP_QUERY        = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION    = '_rest_QueryAtalianJobs';

// WFL-actie die de kenmerken van een Space teruggeeft als { features:[{code,description,value}] }.
// Overschrijfbaar via env zodat room.js niet blokkeert als je de action net anders noemt.
const ACTION_SPACE_FEATURES = process.env.ULTIMO_ACTION_SPACE_FEATURES || 'GET_SPACE_FEATURES';

// === Routing: feature-description → bronsysteem =======================
// Ultimo bepaalt via de kenmerk-naam welk systeem geldt; hier enkel de vertaling naar een handler.
// Room (space) heeft voorlopig alleen de IoT/RealPulse-route nodig.
const ROUTES = [
  { system: 'realpulse', match: /\biot\b|iot\s*factory|realpulse/i },
];

function routeForFeature(description) {
  const d = String(description || '');
  return ROUTES.find((r) => r.match.test(d))?.system || null;
}

// === ENV: RealPulse ==================================================
// Basic Auth, uitsluitend server-side (zie bestaande spec §14). Nog niet gezet? Dan werkt de
// resolve-leg (?debug=1) al wel; enkel de effectieve sensordata-call faalt met een nette fout.
const REALPULSE_USER = process.env.REALPULSE_USER;
const REALPULSE_PASS = process.env.REALPULSE_PASS;
const REALPULSE_BASE = process.env.REALPULSE_BASEURL || 'https://report.iotfactory.eu';

// === Response helper + CORS ==========================================
const json = (status, obj = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
  body: JSON.stringify(obj),
});

// === Omgevingsdetectie (zelfde patroon als space.js) =================
function detectEnvironment(event = {}) {
  const qs = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';
  const isTest =
    qs.test === '1' || qs.test === 'true' || qs.env === 'test' || /test|staging/i.test(host);
  const base = isTest ? ULTIMO_BASE_TEST : ULTIMO_BASE_PROD;
  return { isTest, base, env: isTest ? 'test' : 'prod' };
}

// === Ultimo actie-output parsen ======================================
// De actie-laag levert JSON als string in properties.Output.object, soms tussen enkele quotes;
// "'{}'" betekent 'geen match' (zelfde conventie als de andere GET_-acties in deze WFL).
function parseActionOutput(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  let txt = String(s).trim().replace(/^'(.*)'$/, '$1');
  if (txt.includes('&quot;')) txt = txt.replace(/&quot;/g, '"');
  if (!txt || txt === '{}') return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// === Stap 1: SpaceId → kenmerken via de Query-WFL ====================
async function fetchSpaceFeatures(base, spaceId) {
  const res = await fetch(`${base}/action/${ULTIMO_ACTION}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      ApiKey: ULTIMO_API_KEY,
      ApplicationElementId: APP_QUERY,
    },
    body: JSON.stringify({ Action: ACTION_SPACE_FEATURES, SpaceId: spaceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ultimo ${ACTION_SPACE_FEATURES} fout (${res.status}): ${text.slice(0, 400)}`);
  }
  const body = await res.json().catch(() => ({}));
  const parsed = parseActionOutput(body);
  const list = Array.isArray(parsed?.features) ? parsed.features : [];
  // Normaliseer naar { code, description, value }.
  return list.map((f) => ({
    code: String(f.code ?? f.Code ?? '').trim(),
    description: String(f.description ?? f.Description ?? '').trim(),
    value: String(f.value ?? f.Value ?? '').trim(),
    numeric: String(f.numeric ?? f.Numeric ?? '').trim(),
    yesno: String(f.yesno ?? f.YesNo ?? '').trim(),
  }));
}

// === Stap 2: RealPulse-asset → gesaneerde sensordata =================
async function fetchRealpulseAsset(assetId) {
  if (!REALPULSE_USER || !REALPULSE_PASS) {
    throw new Error('RealPulse-credentials ontbreken (REALPULSE_USER / REALPULSE_PASS).');
  }
  const auth = 'Basic ' + Buffer.from(`${REALPULSE_USER}:${REALPULSE_PASS}`).toString('base64');
  const res = await fetch(`${REALPULSE_BASE}/api/assets/${assetId}`, {
    headers: { Authorization: auth, accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RealPulse asset ${assetId} fout (${res.status}): ${text.slice(0, 300)}`);
  }
  const a = await res.json().catch(() => ({}));
  // last[] is het meest actueel (zie spec §14.3). Filter op de kanalen die het scherm toont.
  const last = Array.isArray(a?.last) ? a.last : [];
  const m = Object.fromEntries(last.map((x) => [x.type, x.value]));
  const co2Ts = last.find((x) => x.type === 'co2')?.timestamp;
  const anyTs = last[0]?.timestamp;
  return {
    temp: m.temperature ?? null,
    co2: m.co2 ?? null,
    hum: m.humidity ?? null,
    motion: m.motion ?? null,
    occupancyRate: m.occupancyRate ?? null,   // % bezetting
    people: m.occupancyCounter ?? null,       // aantal aanwezigen
    capacity: m.capacity ?? null,
    updatedAt: co2Ts ?? anyTs ?? null,
  };
}

// === Handler =========================================================
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET')    return json(405, { error: 'Method not allowed' });

  const qs = event.queryStringParameters || {};
  const spaceId = String(qs.spaceId ?? qs.id ?? '').trim();
  const debug = qs.debug === '1' || qs.debug === 'true';

  if (!spaceId) return json(400, { error: 'Geen spaceId ontvangen.' });
  if (!ULTIMO_API_KEY || !APP_QUERY || !ULTIMO_BASE_PROD) {
    return json(500, { error: 'Serverconfig onvolledig (ULTIMO_API_KEY / APP_ELEMENT_QueryAtalianJobs / ULTIMO_API_BASEURL).' });
  }

  const { base, env } = detectEnvironment(event);

  // Tier bepalen (intern / gast / publiek) uit het uitgaand IP + de wifi-CIDR's uit Ultimo.
  // Faalt veilig naar 'public' → bij twijfel geeft de proxy nooit onbedoeld meer prijs.
  const { tier, ip, networks } = await resolveSpaceTier(event, { base, spaceId, apiKey: ULTIMO_API_KEY, appQuery: APP_QUERY });
  const tierDebug = debug ? { tier, ip, networks } : {};

  try {
    // Stap 1 — kenmerken ophalen en routeren op description
    const features = await fetchSpaceFeatures(base, spaceId);
    const iotFeature = features.find((f) => f.value && routeForFeature(f.description) === 'realpulse');

    // Ruimte-poortwachters voor het verlucht-advies: aantal ramen (numeriek) + thermostaat (ja/nee).
    const winF = features.find((f) => /\braam\b|\bramen\b/i.test(f.description));
    const thF  = features.find((f) => /thermosta/i.test(f.description));
    const capF = features.find((f) => /personen|capacit/i.test(f.description));
    const roomFacts = {
      windows: winF ? (parseInt(winF.numeric || winF.value || '', 10) || 0) : null,
      thermostat: thF ? /^(1|true|yes|ja|y|j|-1)$/i.test(String(thF.yesno || thF.value || '')) : null,
    };
    const capFromFeature = capF ? (parseInt(capF.numeric || capF.value || '', 10) || null) : null;
    if (capFromFeature != null) roomFacts.capacity = capFromFeature; // kenmerk "Aantal personen" wint van RealPulse-capacity

    if (!iotFeature) {
      // Geen IoT-kenmerk → niet gekoppeld. Companion laat de sensorkaarten weg.
      return json(200, {
        coupled: false,
        ...roomFacts,
        tier,
        env,
        ...(debug ? { spaceId, features, ...tierDebug } : {}),
      });
    }

    // Stap 2 — sensordata bij RealPulse (waarde van het kenmerk = asset-id)
    const sensors = await fetchRealpulseAsset(iotFeature.value);
    const full = { coupled: true, ...sensors, ...roomFacts };

    // Stap 3 — redactie volgens tier (server-side afscherming):
    //   internal → alles; guest → comfortcijfers zonder bezetting/aanwezigen;
    //   public   → enkel kwalitatief comfort, geen cijfers.
    let payload;
    if (tier === 'internal') {
      payload = full;
    } else if (tier === 'guest') {
      const { occupancyRate, people, capacity, ...rest } = full;
      payload = rest;
    } else {
      payload = {
        coupled: true,
        comfort: comfortKey(sensors.co2),
        ventilate: sensors.co2 != null && Number(sensors.co2) >= 900,
        ...roomFacts,        // ramen/thermostaat blijven (niet gevoelig, nodig voor het advies)
      };
    }

    return json(200, {
      ...payload,
      tier,
      env,
      ...(debug ? { spaceId, matched: iotFeature, features, ...tierDebug } : {}), // id/kenmerk enkel in debug
    });
  } catch (err) {
    console.error('[room] fout:', err.message);
    return json(502, { error: 'Fout bij ophalen ruimtedata.', detail: String(err?.message || err), env });
  }
}
