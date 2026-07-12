// netlify/functions/news.js
// Live nieuws-ticker voor de companion. Haalt server-side een RSS/Atom-feed per taal op en
// geeft de recentste koppen terug. Server-side (geen CORS-gedoe, feed-URL blijft configureerbaar).
//
// Bron per taal is voorlopig hier ingesteld; later kan de complex-content (companion.json,
// doel:"nieuws") een eigen { label, feed } per taal meegeven (?feed=&label= override).
/* eslint-disable */

const FEEDS = {
  nl: { label: 'VRT NWS', url: 'https://www.vrt.be/vrtnws/nl.rss.articles.xml' },
  fr: { label: '7sur7',   url: 'https://www.7sur7.be/home/rss.xml' },
  en: { label: 'VRT NWS', url: 'https://www.vrt.be/vrtnws/en.rss.articles.xml' },
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
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d+);/g,       (m, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return m; } })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
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
    // link: Atom heeft vaak meerdere <link>-tags (rel="self" = de .rss.xml, rel="alternate" =
    // de artikelpagina). Verkies alternate/text-html en vermijd self; RSS gebruikt <link>URL</link>.
    let link = '';
    const linkTags = b.match(/<link\b[^>]*>/gi) || [];
    for (const t of linkTags) { // 1) expliciet alternate of text/html
      if (/rel=["']alternate["']/i.test(t) || /type=["']text\/html["']/i.test(t)) {
        const h = t.match(/href=["']([^"']+)["']/i); if (h) { link = h[1]; break; }
      }
    }
    if (!link) for (const t of linkTags) { // 2) eerste href die geen 'self' is
      if (/rel=["']self["']/i.test(t)) continue;
      const h = t.match(/href=["']([^"']+)["']/i); if (h) { link = h[1]; break; }
    }
    if (!link) { // 3) RSS: <link>URL</link>
      const lt = b.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      if (lt) link = stripCdata(lt[1]);
    }
    if (link) link = decodeEntities(link); // entiteiten (&#038; enz.) → zuivere URL
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
