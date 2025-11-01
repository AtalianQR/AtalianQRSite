// netlify/functions/space.js
/* eslint-disable */

// === ENV =========================================================
const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL; // fallback

// === Response helper + CORS ======================================
const json = (status, obj = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, ApplicationElementId, ApiKey'
  },
  body: JSON.stringify(obj)
});

// === Omgevingsdetectie (QS of host) ===============================
function detectEnvironment(event = {}) {
  const qs   = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';

  // Steunt op je portal + bestaande patroon in jobsvendor
  const testViaParam =
    qs.test === '1' || qs.test === 'true' ||
    qs.env  === 'test'; // compatibel met &env=test
  const testViaHost  = /test|staging/i.test(host);

  const isTest = !!(testViaParam || testViaHost);
  const base   = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  const env    = isTest ? 'TEST' : 'PROD';

  if (!base) throw new Error('BASE_URL niet gezet voor geselecteerde omgeving.');
  return { isTest, base, env };
}

// === Helpers: CleaningProgram formatting =========================
// CleaningProgram verwacht "1111100;W1" (dagen;frequentie)
// - dagen: string van 7 chars (1=actief), volgorde ma..zo
// - frequentie: D (dagelijks) / Wn (wekelijks / om de n weken) / Mn (maandelijks / om de n maanden)

function getWeekdayNames(daysRaw, lang) {
  const nl = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag'];
  const fr = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  const dagen = lang === 'fr' ? fr : nl;
  const list = [];
  for (let i = 0; i < Math.min(7, daysRaw.length); i++) {
    if (daysRaw[i] === '1') list.push(dagen[i]);
  }
  return list;
}

function getNextCleaningDate(daysRaw) {
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7; // JS: 0=zo; wij: 0=ma
  for (let offset = 0; offset < 7; offset++) {
    const idx = (todayIdx + offset) % 7;
    if (daysRaw[idx] === '1') {
      const next = new Date(now);
      next.setDate(now.getDate() + offset);
      return { offset, nextDate: next };
    }
  }
  return null;
}

function formatCleaningProgram(raw, lang) {
  if (!raw || typeof raw !== 'string' || !raw.includes(';')) return '';
  const [daysRaw = '', freqRaw = ''] = raw.split(';');
  const isFr = lang === 'fr';

  // Frequentie
  const t = String(freqRaw || '').trim();
  const fType = t[0] || '';
  const fVal  = t.slice(1);

  let freqStr = '';
  if (fType === 'D') {
    freqStr = isFr ? 'Quotidiennement' : 'Dagelijks';
  } else if (fType === 'W') {
    if (fVal && fVal !== '1') freqStr = isFr ? `Toutes les ${fVal} semaines` : `Om de ${fVal} weken`;
    else freqStr = isFr ? 'Chaque semaine' : 'Wekelijks';
  } else if (fType === 'M') {
    if (fVal && fVal !== '1') freqStr = isFr ? `Tous les ${fVal} mois` : `Om de ${fVal} maanden`;
    else freqStr = isFr ? 'Chaque mois' : 'Maandelijks';
  }

  // Dagen (mooie zinnen voor gangbare patronen)
  let daysPhrase = '';
  const d = String(daysRaw || '').substring(0,7); // defensief
  if      (d === '1111100') daysPhrase = isFr ? 'du lundi au vendredi' : 'van maandag tot en met vrijdag';
  else if (d === '1111111') daysPhrase = isFr ? 'tous les jours' : 'elke dag';
  else if (d === '0000011') daysPhrase = isFr ? 'le week-end' : 'in het weekend';
  else {
    const list = getWeekdayNames(d, lang);
    if (!list.length) daysPhrase = isFr ? 'jours non spécifiés' : 'dagen niet gespecificeerd';
    else if (list.length === 1) daysPhrase = list[0];
    else {
      const last = list.pop();
      daysPhrase = (lang === 'fr')
        ? `${list.join(', ')} et ${last}`
        : `${list.join(', ')} en ${last}`;
    }
  }

  // Volgende uitvoering (optioneel, kort)
  const next = getNextCleaningDate(d);
  let nextStr = '';
  if (next) {
    if (next.offset === 0) nextStr = isFr ? '(aujourd’hui)' : '(vandaag)';
    else if (next.offset === 1) nextStr = isFr ? '(demain)' : '(morgen)';
    else {
      // Locale zonder vaste kleur/stijl; client toont meldingen
      nextStr = `(${ next.nextDate.toLocaleDateString() })`;
    }
  }

  if (freqStr && daysPhrase) {
    return `${freqStr} – ${daysPhrase} ${nextStr}`.trim();
  }
  if (daysPhrase) return daysPhrase;
  return freqStr || '';
}

// === Handler =====================================================
export async function handler(event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  try {
    if (!API_KEY || !BASE_URL_PROD) {
      return json(500, { description: '', error: 'Server misconfiguratie (env-variabelen ontbreken).' });
    }

    // Params
    const spaceId = String(event.queryStringParameters?.id ?? '').trim();
    const langRaw = String(event.queryStringParameters?.lang ?? '').toLowerCase();
    const lang = langRaw === 'fr' ? 'fr' : 'nl';
    if (!spaceId) return json(400, { description: '', error: 'Geen geldig ID ontvangen.' });

    // Env
    const { base, env } = detectEnvironment(event);

    // Ultimo call
    const url = `${base}/object/Space('${spaceId}')`;
    const res = await fetch(url, { headers: { accept: 'application/json', ApiKey: API_KEY } });

    if (res.status === 404) {
      return json(404, {
        description: '',
        error: (lang === 'fr')
          ? `Local avec ID ${spaceId} introuvable.`
          : `Ruimte met ID ${spaceId} niet gevonden.`,
        env
      });
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return json(res.status, {
        description: '',
        error: (lang === 'fr') ? 'Erreur lors du chargement du local.' : 'Fout bij ophalen van ruimte.',
        detail: txt.slice(0, 800),
        env
      });
    }

    const data = await res.json().catch(() => ({}));
    const beschrijving =
      data?.Description ??
      data?.description ??
      data?.properties?.Description ??
      data?.properties?.description ??
      (lang === 'fr' ? 'Aucune description trouvée.' : 'Geen beschrijving gevonden.');

    const cleaningProgram =
      data?._CleaningProgram ??
      data?.properties?._CleaningProgram ??
      '';

    const cleaningProgramFormatted = cleaningProgram
      ? formatCleaningProgram(String(cleaningProgram), lang)
      : '';

    return json(200, {
      description: String(beschrijving || '').trim(),
      cleaningProgram: String(cleaningProgram || ''),
      cleaningProgramFormatted,
      env
    });

  } catch (err) {
    return json(500, {
      description: '',
      error: 'Serverfout bij ophalen.',
      detail: String(err?.message || err)
    });
  }
}
