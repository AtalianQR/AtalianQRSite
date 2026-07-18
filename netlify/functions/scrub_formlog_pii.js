// netlify/functions/scrub_formlog_pii.js — EENMALIG opschoonscript.
// Verwijdert de velden "ip" en "ua" uit bestaande "formlog"-records. Sinds
// 18-07-2026 schrijft formlog.js die velden niet meer weg (zie §9.4 van het
// auditdocument), maar records van vóór die datum dragen ze nog. Dit script
// maakt de historiek gelijk aan het nieuwe gedrag, ZONDER de flow-geschiedenis
// te verliezen: enkel de twee velden gaan eruit, het record blijft bestaan.
// Na gebruik weer verwijderen uit de repo.
//
// Gebruik:
//   1) DROOGLOOP (standaard, wijzigt niets) — toont totalen en datumbereik:
//        /.netlify/functions/scrub_formlog_pii
//   2) ECHT OPSCHONEN — per blok van 400, met ?offset= uit "next_offset":
//        /.netlify/functions/scrub_formlog_pii?apply=1
//        /.netlify/functions/scrub_formlog_pii?apply=1&offset=400
//        /.netlify/functions/scrub_formlog_pii?apply=1&offset=800
//      ... herhalen tot "next_offset": null.
//
// LET OP: het script schuift NIET vanzelf op. Zonder ?offset= behandelt elke
// aanroep dezelfde eerste 400 sleutels. Neem dus telkens de waarde van
// "next_offset" over in de volgende aanroep.
//
// De droogloop is bewust de standaard: opschonen is onomkeerbaar.

import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};

const PII_FIELDS = ['ip', 'ua'];

function hasPii(data) {
  return PII_FIELDS.some((f) => data?.[f] !== undefined);
}

// Sleutelformaat: <code>/<dag>/<ts>-<type>-<rand>.json
// Het tijdstip zit dus IN de naam: het globale datumbereik is te bepalen zonder
// ook maar één record te downloaden.
function tsFromKey(key) {
  const fname = (key.split('/').pop() || '').replace(/\.json$/i, '');
  const ts = Number(fname.split('-')[0]);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

export default async (req) => {
  const url = new URL(req.url);

  // Zonder ?apply=1 wordt er niets geschreven: enkel geteld.
  const apply = url.searchParams.get('apply') === '1';

  // Aantal records per aanroep — ruim binnen de functietimeout.
  const perCallLimit = Math.min(2000, Math.max(50, parseInt(url.searchParams.get('limit') ?? '400', 10)));

  // Startpositie in de (gesorteerde) sleutellijst. Het script houdt zelf GEEN
  // voortgang bij: de aanroeper schuift op met de "next_offset" uit het antwoord.
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);

  const store = getStore('formlog');

  const allKeys = [];
  let cursor;
  while (true) {
    const page = await store.list(cursor ? { cursor } : {});
    for (const b of page?.blobs || []) { if (b?.key) allKeys.push(b.key); }
    cursor = page?.cursor ?? null;
    if (!cursor) break;
  }

  // Sorteren zodat de volgorde tussen aanroepen stabiel is en ?offset= betrouwbaar
  // dezelfde positie aanwijst. Nieuwe records komen er tussendoor bij, maar die
  // zijn sowieso al schoon (formlog.js schrijft geen PII meer weg).
  allKeys.sort();

  // Globaal datumbereik van ALLE records, afgeleid uit de sleutelnamen — dus
  // zonder downloads, en niet beperkt tot het blok dat deze aanroep bekijkt.
  let allOldest = null, allNewest = null;
  for (const k of allKeys) {
    const t = tsFromKey(k);
    if (!t) continue;
    if (!allOldest || t < allOldest) allOldest = t;
    if (!allNewest || t > allNewest) allNewest = t;
  }

  let cleaned = 0, clean_already = 0, errors = 0;
  let oldest = null, newest = null;

  const todo = allKeys.slice(offset, offset + perCallLimit);
  const nextOffset = offset + todo.length < allKeys.length ? offset + todo.length : null;
  const remaining = Math.max(0, allKeys.length - (offset + todo.length));

  const BATCH = 30;
  for (let i = 0; i < todo.length; i += BATCH) {
    const results = await Promise.all(todo.slice(i, i + BATCH).map(async (key) => {
      try {
        const val = await store.get(key);
        if (!val) return { r: 'error' };

        const data = JSON.parse(val);
        const ts = Number(data?.ts) || null;

        if (!hasPii(data)) return { r: 'clean', ts };
        if (!apply) return { r: 'would_clean', ts };

        for (const f of PII_FIELDS) delete data[f];

        // Zelfde sleutel overschrijven: geen nieuwe key, geen verweesde kopie.
        await store.set(key, JSON.stringify(data), { contentType: 'application/json' });
        return { r: 'cleaned', ts };
      } catch {
        return { r: 'error' };
      }
    }));

    for (const { r, ts } of results) {
      if (r === 'cleaned' || r === 'would_clean') cleaned++;
      else if (r === 'clean') clean_already++;
      else errors++;

      // Datumbereik van de records die PII dragen — geeft meteen zicht op
      // hoever de historiek teruggaat.
      if ((r === 'cleaned' || r === 'would_clean') && ts) {
        if (!oldest || ts < oldest) oldest = ts;
        if (!newest || ts > newest) newest = ts;
      }
    }
  }

  const iso = (t) => (t ? new Date(t).toISOString() : null);

  return new Response(JSON.stringify({
    mode: apply ? 'APPLY (records aangepast)' : 'DROOGLOOP (niets gewijzigd - voeg ?apply=1 toe)',
    total_records: allKeys.length,

    // Bereik van ALLE records, uit de sleutelnamen (geen downloads).
    range_oldest: iso(allOldest),
    range_newest: iso(allNewest),

    // Dit blok:
    offset,
    scanned: todo.length,
    with_pii: cleaned,
    already_clean: clean_already,
    errors,
    block_pii_oldest: iso(oldest),
    block_pii_newest: iso(newest),

    // Volgende stap: neem next_offset over in de volgende aanroep.
    // null = klaar, alle sleutels zijn behandeld.
    next_offset: nextOffset,
    remaining
  }, null, 2), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
};
