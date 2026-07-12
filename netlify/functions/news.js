// netlify/functions/news.js
// Live nieuws-ticker voor de companion. Haalt server-side een RSS/Atom-feed per taal op en
// geeft de recentste koppen terug. Server-side (geen CORS-gedoe, feed-URL blijft configureerbaar).
//
// Bron per taal is voorlopig hier ingesteld; later kan de complex-content (companion.json,
// doel:"nieuws") een eigen { label, feed } per taal meegeven (?feed=&label= override).
/* eslint-disable */

const FEEDS = {
  nl: { label: 'VRT NWS',          url: 'https://www.vrt.be/vrtnws/nl.rss.articles.xml' },
  fr: { label: '7sur7',            url: 'https://www.7sur7.be/home/rss.xml' },
  en: { label: 'Politico Europe',  url: 'https://www.politico.eu/feed/' },
};

const json = (status, obj = {}, extraHeaders = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300', // 5 min: nieuws hoeft niet realtime
    ...extraHeaders,
  },
  body: JSON.stringify(obj),
});

function stripCdata(s) {
  return String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}
function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')                 // eventuele inline HTML weg
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const tm = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!tm) continue;
    const title = decodeEntities(stripCdata(tm[1]));
    if (!title) continue;
    // link: Atom <link href="..">, of RSS <link>..</link>
    let link = '';
    const lh = b.match(/<link[^>]*\bhref=["']([^"']+)["']/i);
    if (lh) link = lh[1];
    else {
      const lt = b.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      if (lt) link = decodeEntities(stripCdata(lt[1]));
    }
    items.push({ title, link });
    if (items.length >= 15) break;
  }
  return items;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  const qs = event.queryStringParameters || {};
  const langRaw = String(qs.lang || 'nl').toLowerCase();
  const lang = ['nl', 'fr', 'en'].includes(langRaw) ? langRaw : 'nl';

  const def = FEEDS[lang];
  const url = String(qs.feed || def.url);
  const label = String(qs.label || def.label);

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AtalianCompanion)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!res.ok) return json(200, { source: label, items: [] });
    const xml = await res.text();
    const items = parseFeed(xml);
    return json(200, { source: label, items });
  } catch (err) {
    console.error('[news] fout:', err.message);
    return json(200, { source: label, items: [] }); // ticker verdwijnt gewoon bij fout
  }
}
