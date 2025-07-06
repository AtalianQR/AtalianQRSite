import { API_KEY, BASE_URL } from "./APIConfig_prod.js";

// -- Voeg backend parsing/formatting toe --
// In je prod_space.js (bovenaan):
function getWeekdayNames(daysRaw, lang) {
  // ["maandag", "dinsdag", ...] of ["lundi", ...]
  const dagenNl = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag'];
  const dagenFr = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  const dagen = lang === 'fr' ? dagenFr : dagenNl;
  let daysList = [];
  for (let i=0; i<daysRaw.length; ++i) {
    if (daysRaw[i]==='1') {
      daysList.push(dagen[i]);
    }
  }
  return daysList;
}

function getNextCleaningDate(daysRaw) {
  const now = new Date();
  const todayIdx = (now.getDay() + 6) % 7; // JS: 0=zo, hier: 0=ma
  for (let offset = 0; offset < 7; offset++) {
    const idx = (todayIdx + offset) % 7;
    if (daysRaw[idx] === "1") {
      const nextDate = new Date(now);
      nextDate.setDate(now.getDate() + offset);
      return {offset, nextDate};
    }
  }
  return null;
}

function formatCleaningProgram(raw, lang) {
  if (!raw) return "";
  const parts = raw.split(";");
  if (parts.length < 2) return raw;

  const daysRaw = parts[0];
  const freqRaw = parts[1];
  const isFr = lang === 'fr';

  // Frequentie uitleg
  let freqType = freqRaw[0];
  let freqVal  = freqRaw.slice(1);

  let freqStr = '';
  if (freqType === 'D') {
    freqStr = isFr ? 'Quotidiennement' : 'Dagelijks';
  } else if (freqType === 'W') {
    if (freqVal && freqVal !== "1") {
      freqStr = isFr ? `Toutes les ${freqVal} semaines` : `Om de ${freqVal} weken`;
    } else {
      freqStr = isFr ? 'Chaque semaine' : 'Wekelijks';
    }
  } else if (freqType === 'M') {
    if (freqVal && freqVal !== "1") {
      freqStr = isFr ? `Tous les ${freqVal} mois` : `Om de ${freqVal} maanden`;
    } else {
      freqStr = isFr ? 'Chaque mois' : 'Maandelijks';
    }
  }

  // Dagen
  const daysList = getWeekdayNames(daysRaw, lang);

// Nette zin - slimme herkenning patronen
  let daysPhrase = '';
  // Patronen als string voor snelle matching
  const pattern = daysRaw;

  if (pattern === '1111100') {
    daysPhrase = isFr ? "chaque jour ouvrable" : "op elke werkdag";
  } else if (pattern === '0000011') {
    daysPhrase = isFr ? "le week-end" : "in het weekend";
  } else if (pattern === '1111111') {
    daysPhrase = isFr ? "tous les jours" : "op elke dag";
  } else if (pattern.match(/^0*1+0*$/)) {
    // Reeks van dagen (bijv. 0111110 = di-za)
    const first = daysList[0];
    const last = daysList[daysList.length - 1];
    if (daysList.length > 1) {
      daysPhrase = isFr
        ? `du ${first} au ${last}`
        : `van ${first} t/m ${last}`;
    } else {
      daysPhrase = isFr ? `le ${first}` : `op ${first}`;
    }
  } else if (daysList.length === 1) {
    daysPhrase = isFr ? `le ${daysList[0]}` : `op ${daysList[0]}`;
  } else if (daysList.length > 1) {
    const last = daysList.pop();
    daysPhrase = isFr
      ? `les ${daysList.join(', ')} et ${last}`
      : `op ${daysList.join(', ')} en ${last}`;
  } else {
    daysPhrase = isFr ? "(aucun jour)" : "(geen dag)";
  }
  
  // Emoji Poetsfrequentie
	let freqEmoji = '';
	if (freqType === 'D') freqEmoji = '🌞';
	else if (freqType === 'W') freqEmoji = '🔁';
	else if (freqType === 'M') freqEmoji = '📅';

  // Volgende beurt
  const next = getNextCleaningDate(daysRaw);
  let nextText = '';
  if (next) {
    const n = next.nextDate;
    const nu = new Date();
    n.setHours(0,0,0,0);
    nu.setHours(0,0,0,0);
    if (n.getTime() === nu.getTime()) {
      nextText = isFr
        ? "<b>Aujourd’hui</b>, un nettoyage est prévu."
        : "Er is <b>vandaag</b> een poetsbeurt gepland.";
    } else {
		// Afkortingen dagen
		const dagAfkNl = ['zo','ma','di','wo','do','vr','za'];
		const dagAfkFr = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
		const dagAfk = isFr ? dagAfkFr : dagAfkNl;

		// Weekdag halen: let op, JS: 0=zo, 1=ma, ...
		const dagNum = n.getDay();
		const dagAfkort = dagAfk[dagNum];

		const d = ('0'+n.getDate()).slice(-2);
		const m = ('0'+(n.getMonth()+1)).slice(-2);
		const y = n.getFullYear();

		nextText = isFr
		  ? `Le prochain nettoyage est prévu le <br>📅 <b>${dagAfkort} ${d}-${m}-${y}</b>.`
		  : `De volgende poetsbeurt is voorzien op <br>📅 <b>${dagAfkort} ${d}-${m}-${y}</b>.`;
			}
  }

  return `${freqEmoji} ${freqStr} ${daysPhrase}.<br><br>🧹 ${nextText}`;
}


export async function handler(event) {
  const { id: spaceId, lang = 'nl' } = event.queryStringParameters || {};

  if (!spaceId) {
    console.error("Missing 'id' parameter");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Geen geldig ID ontvangen." }),
    };
  }

  const url = `${BASE_URL}/object/Space('${spaceId}')`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        ApiKey: API_KEY,
      },
    });

    // Specifieke handling als de ruimte niet bestaat (meestal 404)
    if (response.status === 404) {
      console.warn(`Ruimte met ID ${spaceId} niet gevonden.`);
      return {
        statusCode: 404,
        body: JSON.stringify({
          description: "",
          error: `Ruimte met ID ${spaceId} niet gevonden.`,
        }),
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultimo API returned non-200:", response.status, errorText);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          description: "",
          error: "Fout bij ophalen van ruimte.",
          detail: errorText,
        }),
      };
    }

    const data = await response.json();
    // Beschrijving ophalen
    let beschrijving = data.Description || data.description || "";
    if (!beschrijving && data.properties) {
      beschrijving =
        data.properties.Description || data.properties.description || "";
    }

    // CleaningProgram ophalen (altijd, ook leeg als niet aanwezig)
    let cleaningProgram = data._CleaningProgram || (data.properties && data.properties._CleaningProgram) || "";

    // Formatting gebeurt nu HIER!
    let cleaningProgramFormatted = cleaningProgram
      ? formatCleaningProgram(cleaningProgram, lang)
      : "";

    return {
      statusCode: 200,
      body: JSON.stringify({
        description: beschrijving || "Geen beschrijving gevonden.",
        cleaningProgram: cleaningProgram ?? "",
        cleaningProgramFormatted: cleaningProgramFormatted,
        error: "",
      }),
    };

  } catch (error) {
    console.error("Serverfout bij ophalen:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        description: "",
        error: "Serverfout bij ophalen.",
        detail: error.message,
      }),
    };
  }
}
