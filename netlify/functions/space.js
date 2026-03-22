// netlify/functions/space.js
/* eslint-disable */

/*
000D000|0D00000;MW1|MW2;K werkt nu als 2 aparte regels
00D0000|000V000;W2;K werkt nu als even/onpaar weken
0000000;M;ML blijft inhoudelijk dagen niet gespecificeerd, want daar zit nog altijd geen actieve dag in
*/

// === ENV =========================================================
const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL_PROD = process.env.ULTIMO_API_BASEURL;
const BASE_URL_TEST = process.env.ULTIMO_API_BASEURL_TEST || process.env.ULTIMO_API_BASEURL;

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

// === Omgevingsdetectie ===========================================
function detectEnvironment(event = {}) {
  const qs = event.queryStringParameters || {};
  const host = (event.headers && event.headers.host) || '';

  const testViaParam =
    qs.test === '1' || qs.test === 'true' ||
    qs.env === 'test';
  const testViaHost = /test|staging/i.test(host);

  const isTest = !!(testViaParam || testViaHost);
  const base = isTest ? BASE_URL_TEST : BASE_URL_PROD;
  const env = isTest ? 'TEST' : 'PROD';

  if (!base) throw new Error('BASE_URL niet gezet voor geselecteerde omgeving.');
  return { isTest, base, env };
}

// === Config ======================================================
const WEEKDAY_NAMES = {
  nl: ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'],
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
};

const SLOT_LABELS = {
  nl: {
    '0': null,
    '1': 'overdag',
    'D': 'overdag',
    'V': 'voormiddag',
    'N': 'namiddag',
    'A': '08:00–12:00',
    'B': '10:00–11:00',
    'C': '12:30–16:30'
  },
  fr: {
    '0': null,
    '1': 'en journée',
    'D': 'en journée',
    'V': 'avant-midi',
    'N': 'après-midi',
    'A': '08:00–12:00',
    'B': '10:00–11:00',
    'C': '12:30–16:30'
  }
};

// === Date helpers ===============================================
function formatLocalDate(date, lang) {
  return new Intl.DateTimeFormat(
    lang === 'fr' ? 'fr-BE' : 'nl-BE',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }
  ).format(date);
}

function getIsoWeekNumber(date) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

function isEvenWeek(date) {
  return getIsoWeekNumber(date) % 2 === 0;
}

function getWeekOfMonth(date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDow = (firstDay.getDay() + 6) % 7; // ma=0
  return Math.ceil((date.getDate() + firstDow) / 7);
}

function addMonths(date, monthsToAdd) {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + monthsToAdd);

  // voorkom overspringen door korte maanden
  while (d.getDate() < originalDay) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

// === Code helpers ===============================================
function normalizeDayCodes(daysRaw) {
  return String(daysRaw || '')
    .substring(0, 7)
    .padEnd(7, '0')
    .toUpperCase();
}

function normalizeDayCode(code) {
  if (!code) return '0';
  return code === '1' ? 'D' : String(code).toUpperCase();
}

function getSlotLabel(code, lang) {
  const normalized = normalizeDayCode(code);
  const labels = SLOT_LABELS[lang === 'fr' ? 'fr' : 'nl'] || {};
  return labels[normalized] ?? `code ${normalized}`;
}

// === Parsing =====================================================
function parseCleaningProgram(raw) {
  const parts = String(raw || '').split(';');

  const daySets = String(parts[0] || '')
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const freqSets = String(parts[1] || '')
    .toUpperCase()
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const typeRaw = String(parts[2] || '').trim();

  return {
    daySets,
    freqSets,
    typeRaw
  };
}

function buildProgramRules(raw) {
  const parsed = parseCleaningProgram(raw);

  if (!parsed.daySets.length || !parsed.freqSets.length) {
    return [];
  }

  // parity-split binnen één regel: days1|days2 ; W2 ; type
  if (parsed.freqSets.length === 1 && parsed.freqSets[0] === 'W2' && parsed.daySets.length === 2) {
    return [{
      mode: 'biweekly_split',
      evenDaysRaw: normalizeDayCodes(parsed.daySets[0]),
      oddDaysRaw: normalizeDayCodes(parsed.daySets[1]),
      freqRaw: 'W2',
      typeRaw: parsed.typeRaw
    }];
  }

  // klassieke single rule
  if (parsed.daySets.length === 1 && parsed.freqSets.length === 1) {
    return [{
      mode: 'single',
      daysRaw: normalizeDayCodes(parsed.daySets[0]),
      freqRaw: parsed.freqSets[0],
      typeRaw: parsed.typeRaw
    }];
  }

  // parallel model: days1|days2|... ; freq1|freq2|...
  if (parsed.daySets.length === parsed.freqSets.length) {
    return parsed.daySets.map((daysRaw, idx) => ({
      mode: 'single',
      daysRaw: normalizeDayCodes(daysRaw),
      freqRaw: parsed.freqSets[idx],
      typeRaw: parsed.typeRaw
    }));
  }

  // mismatch => ongeldige config
  return [];
}

// === Frequency logic ============================================
function formatFrequency(freqRaw, lang) {
  const isFr = lang === 'fr';
  const t = String(freqRaw || '').trim().toUpperCase();

  if (!t) return '';

  if (t === 'D') {
    return isFr ? 'Quotidiennement' : 'Dagelijks';
  }

  if (t === 'W1') {
    return isFr ? 'Chaque semaine' : 'Wekelijks';
  }

  if (t === 'W2') {
    return isFr ? 'Toutes les 2 semaines' : 'Om de 2 weken';
  }

  if (t === 'W2E') {
    return isFr
      ? 'Toutes les 2 semaines (semaines paires)'
      : 'Om de 2 weken (even weken)';
  }

  if (t === 'W2O') {
    return isFr
      ? 'Toutes les 2 semaines (semaines impaires)'
      : 'Om de 2 weken (oneven weken)';
  }

  if (t === 'M') {
    return isFr ? 'Chaque mois' : 'Maandelijks';
  }

if (t === 'M') {
  return isFr ? 'Chaque mois' : 'Maandelijks';
}

if (/^M\d+$/.test(t)) {
  const n = t.slice(1);

  if (n === '1') {
    return isFr ? 'Chaque mois' : 'Om de maand';
  }

  return isFr ? `Tous les ${n} mois` : `Om de ${n} maanden`;
}

  if (/^MW[1-5]$/.test(t)) {
    const w = t.slice(2);
    const nlMap = {
      '1': 'eerste week van de maand',
      '2': 'tweede week van de maand',
      '3': 'derde week van de maand',
      '4': 'vierde week van de maand',
      '5': 'vijfde week van de maand'
    };
    const frMap = {
      '1': 'première semaine du mois',
      '2': 'deuxième semaine du mois',
      '3': 'troisième semaine du mois',
      '4': 'quatrième semaine du mois',
      '5': 'cinquième semaine du mois'
    };
    return isFr ? frMap[w] : nlMap[w];
  }

  if (/^W\d+$/.test(t)) {
    const n = t.slice(1);
    return isFr ? `Toutes les ${n} semaines` : `Om de ${n} weken`;
  }

  return t;
}

function ruleMatchesDate(rule, date) {
  const freq = String(rule.freqRaw || '').trim().toUpperCase();

  if (!freq || freq === 'W1' || freq === 'D') return true;

  if (freq === 'W2') return true;
  if (freq === 'W2E') return isEvenWeek(date);
  if (freq === 'W2O') return !isEvenWeek(date);

  if (freq === 'M') {
    return true;
  }

  if (/^M\d+$/.test(freq)) {
    const n = parseInt(freq.slice(1), 10);
    if (!Number.isFinite(n) || n < 1) return false;

    const baseMonth = 0; // januari als anker
    return ((date.getMonth() - baseMonth + 12) % n) === 0;
  }

  if (/^MW[1-5]$/.test(freq)) {
    const targetWeek = parseInt(freq.slice(2), 10);
    return getWeekOfMonth(date) === targetWeek;
  }

  return true;
}

function getRuleDaysRawForDate(rule, date) {
  if (rule.mode === 'biweekly_split') {
    return isEvenWeek(date) ? rule.evenDaysRaw : rule.oddDaysRaw;
  }
  return rule.daysRaw;
}

// === Display helpers ============================================
function parseDaySlots(daysRaw, lang) {
  const d = normalizeDayCodes(daysRaw);
  const weekdays = WEEKDAY_NAMES[lang === 'fr' ? 'fr' : 'nl'];

  const result = [];
  for (let i = 0; i < 7; i++) {
    const code = normalizeDayCode(d[i]);
    if (code !== '0') {
      result.push({
        dayIndex: i,
        dayName: weekdays[i],
        code,
        slotLabel: getSlotLabel(code, lang)
      });
    }
  }
  return result;
}

function formatDaySlotList(daysRaw, lang) {
  const isFr = lang === 'fr';
  const items = parseDaySlots(daysRaw, lang).map((item) => `${item.dayName} (${item.slotLabel})`);

  if (!items.length) {
    return isFr ? 'jours non spécifiés' : 'dagen niet gespecificeerd';
  }

  if (items.length === 1) return items[0];

  const last = items.pop();
  return isFr
    ? `${items.join(', ')} et ${last}`
    : `${items.join(', ')} en ${last}`;
}

function formatRuleForDisplay(rule, lang) {
  const isFr = lang === 'fr';
  const freq = String(rule.freqRaw || '').trim().toUpperCase();
  const freqText = formatFrequency(freq, lang);

  if (rule.mode === 'biweekly_split') {
    const evenText = formatDaySlotList(rule.evenDaysRaw, lang);
    const oddText = formatDaySlotList(rule.oddDaysRaw, lang);

    return isFr
      ? `${freqText} – semaines paires : ${evenText}; semaines impaires : ${oddText}`
      : `${freqText} – even weken: ${evenText}; oneven weken: ${oddText}`;
  }

  const daysText = formatDaySlotList(rule.daysRaw, lang);

  if (freqText && daysText) return `${freqText} – ${daysText}`;
  if (freqText) return freqText;
  return daysText;
}

function formatRulesForDisplay(rules, lang) {
  const isFr = lang === 'fr';

  if (!rules.length) {
    return isFr ? 'Programme non spécifié' : 'Programma niet gespecificeerd';
  }

  if (rules.length === 1) {
    return formatRuleForDisplay(rules[0], lang);
  }

  return rules
    .map((rule) => formatRuleForDisplay(rule, lang))
    .join('<br>');
}

// === Next cleaning ==============================================
function getNextCleaningDateFromRules(rules, lang) {
  const weekdays = WEEKDAY_NAMES[lang === 'fr' ? 'fr' : 'nl'];

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let offset = 0; offset < 93; offset++) {
    const candidate = addMonths(today, 0);
    candidate.setDate(today.getDate() + offset);

    const candidateIdx = (candidate.getDay() + 6) % 7;

    for (const rule of rules) {
      if (!ruleMatchesDate(rule, candidate)) continue;

      const activeDaysRaw = getRuleDaysRawForDate(rule, candidate);
      const code = normalizeDayCode(activeDaysRaw[candidateIdx]);

      if (code !== '0') {
        return {
          offset,
          nextDate: candidate,
          isToday: offset === 0,
          isTomorrow: offset === 1,
          code,
          dayName: weekdays[candidateIdx],
          slotLabel: getSlotLabel(code, lang),
          freqRaw: rule.freqRaw
        };
      }
    }
  }

  return null;
}

function formatNextCleaningText(rules, lang) {
  const isFr = lang === 'fr';
  const next = getNextCleaningDateFromRules(rules, lang);

  if (!next) return '';

  const slotSuffix = next.slotLabel ? ` (${next.slotLabel})` : '';

  if (next.isToday) {
    return isFr
      ? `Prochaine prestation : aujourd’hui${slotSuffix}`
      : `Volgende poetsbeurt: vandaag${slotSuffix}`;
  }

  if (next.isTomorrow) {
    return isFr
      ? `Prochaine prestation : demain${slotSuffix}`
      : `Volgende poetsbeurt: morgen${slotSuffix}`;
  }

  return isFr
    ? `Prochaine prestation : ${formatLocalDate(next.nextDate, lang)}${slotSuffix}`
    : `Volgende poetsbeurt: ${formatLocalDate(next.nextDate, lang)}${slotSuffix}`;
}

// === Main formatter =============================================
function formatCleaningProgram(raw, lang) {
  if (!raw || typeof raw !== 'string') return '';

  const rules = buildProgramRules(raw);
  if (!rules.length) {
    return lang === 'fr'
      ? 'Programme non spécifié'
      : 'Programma niet gespecificeerd';
  }

  const scheduleStr = formatRulesForDisplay(rules, lang);
  const nextStr = formatNextCleaningText(rules, lang);

  if (scheduleStr && nextStr) {
    return `${scheduleStr}<br><strong>${nextStr}</strong>`;
  }

  return scheduleStr || nextStr || '';
}

// === Handler =====================================================
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  try {
    if (!API_KEY || !BASE_URL_PROD) {
      return json(500, {
        description: '',
        error: 'Server misconfiguratie (env-variabelen ontbreken).'
      });
    }

    const spaceId = String(event.queryStringParameters?.id ?? '').trim();
    const langRaw = String(event.queryStringParameters?.lang ?? '').toLowerCase();
    const lang = langRaw === 'fr' ? 'fr' : 'nl';

    if (!spaceId) {
      return json(400, {
        description: '',
        error: 'Geen geldig ID ontvangen.'
      });
    }

    const { base, env } = detectEnvironment(event);

    const url = `${base}/object/Space('${spaceId}')`;
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        ApiKey: API_KEY
      }
    });

    if (res.status === 404) {
      return json(404, {
        description: '',
        error: lang === 'fr'
          ? `Local avec ID ${spaceId} introuvable.`
          : `Ruimte met ID ${spaceId} niet gevonden.`,
        env
      });
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return json(res.status, {
        description: '',
        error: lang === 'fr'
          ? 'Erreur lors du chargement du local.'
          : 'Fout bij ophalen van ruimte.',
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