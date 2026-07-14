// netlify/functions/lib/weather.js
// Publiek weer: buitentemperatuur/vochtigheid uit de RealPulse WEATHER-asset ("eigen sensor")
// + uurforecast van Open-Meteo (een sensor voorspelt niet). Geen bedrijfsgevoelige data — dit
// blok blijft altijd zichtbaar, ongeacht tier. De occupancy/energie-parsing zit in lib/occupancy.js.
/* eslint-disable */

// Verzamel alle Weather-metingen (temperature/humidity/…) ongeacht hun pad in de asset-JSON.
export function collectWeather(obj) {
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

// Uurforecast (+2u/+4u/+6u, zoals de mockup 14u/16u/18u) + huidige weer van Open-Meteo.
// De actuele temp/vocht dienen als FALLBACK voor de buitentemp wanneer de IoT-sensor niets geeft
// (asset onbereikbaar of geen temperature-meting) — zo toont de kaart nooit een leeg "–".
export async function forecastFromOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&hourly=temperature_2m,weather_code&timezone=Europe%2FBrussels&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) return { code: null, temp: null, hum: null, forecast: [] };
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
  return {
    code: d?.current?.weather_code ?? null,
    temp: d?.current?.temperature_2m ?? null,
    hum: d?.current?.relative_humidity_2m ?? null,
    forecast,
  };
}
