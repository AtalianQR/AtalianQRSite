// netlify/functions/lib/occupancy.js
// Bedrijfsgevoelige gebouwdata uit de RealPulse WEATHER-asset: BEZETTINGSGRAAD (drukte) en
// ENERGIEVERBRUIK. Verraadt wanneer het gebouw leeg staat → enkel voor tier 'internal'/'guest'
// (zie de handler in weather.js). Deze module doet GÉÉN eigen fetch; ze krijgt de reeds-opgehaalde
// asset-JSON binnen zodat weer + occupancy één RealPulse-call delen.
/* eslint-disable */

// Totaal aantal desks/vergaderzalen = statische gebouwfeiten (Anderlecht: 30 desks, 6 zalen).
// De asset geeft dit niet betrouwbaar terug (deling count/graad wisselt), dus zetten we het vast en
// leiden het AANTAL af uit de betrouwbare bezettingsgraad (rate × totaal). Overschrijfbaar via
// ?deskTotal=&meetingTotal= (later ideaal een gebouwkenmerk in Ultimo).
export const DESK_TOTAL = 30;
export const MEETING_TOTAL = 6;

// Parse bezetting + energie uit de asset-JSON.
//   a            : reeds-opgehaalde RealPulse asset-JSON
//   deskTotal    : vast totaal werkplekken (voor rate→aantal)
//   meetingTotal : vast totaal vergaderzalen
//   debug        : voeg occupancyDebug (bron-previews) toe
// → { occupancy, energy, occupancyDebug? }
export function parseOccupancy(a, { deskTotal = DESK_TOTAL, meetingTotal = MEETING_TOTAL, debug = false } = {}) {
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
