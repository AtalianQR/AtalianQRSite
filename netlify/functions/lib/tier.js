// netlify/functions/lib/tier.js
// Netwerk-tiering voor de companion. Bepaalt of de bezoeker op een intern/gast-netwerk zit
// (via het uitgaand publieke IP) of daarbuiten (publiek). De wifi-CIDR's komen uit Ultimo-
// kenmerken 000157 "Wifi Intern" en 000158 "Wifi Guest", verzameld op complex-, gebouw- en
// space-niveau (overerving/union) door de WFL-actie GET_SPACE_NETWORKS.
//
// BELANGRIJK: een browser kan de wifi-naam (SSID) NIET aan een pagina doorgeven. Het enige
// betrouwbare signaal server-side is het publieke IP-adres. Daarom matchen we dat tegen de
// CIDR-bereiken. Redactie gebeurt uitsluitend server-side (de client mag de tier niet bepalen).
/* eslint-disable */
import { BlockList, isIP } from 'node:net';

// Echte client-IP: de meest LINKSE waarde van x-forwarded-for is de oorspronkelijke bezoeker
// (rechts staan tussenliggende proxies). Met fallbacks; zone-id/poort/brackets weg en een
// IPv4-in-IPv6-mapping (::ffff:1.2.3.4) terug naar puur IPv4.
export function clientIp(event = {}) {
  const h = event.headers || {};
  const pick = (k) => h[k] ?? h[k.toLowerCase()] ?? h[k.toUpperCase()];
  const xff = String(pick('x-forwarded-for') || '').split(',')[0].trim();
  let ip = xff || pick('x-nf-client-connection-ip') || pick('client-ip') || '';
  ip = String(ip).trim().replace(/^\[/, '').replace(/\]$/, '').replace(/%.*$/, '');
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}

// "a/64; b, c\nd" → ['a/64','b','c','d'] (scheiders: spatie, komma, puntkomma, nieuwe regel).
function parseList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

// Zit het IP in één van de CIDR's/adressen? Werkt voor IPv4 en IPv6 via net.BlockList.
function inList(ip, entries) {
  const fam = isIP(ip); // 0 = ongeldig, 4, of 6
  if (!fam || !entries.length) return false;
  const bl = new BlockList();
  let added = 0;
  for (const e of entries) {
    try {
      if (e.includes('/')) {
        const [addr, pfx] = e.split('/');
        if (!isIP(addr)) continue;
        bl.addSubnet(addr, parseInt(pfx, 10), isIP(addr) === 6 ? 'ipv6' : 'ipv4');
        added++;
      } else if (isIP(e)) {
        bl.addAddress(e, isIP(e) === 6 ? 'ipv6' : 'ipv4');
        added++;
      }
    } catch { /* ongeldige regel overslaan */ }
  }
  if (!added) return false;
  try { return bl.check(ip, fam === 6 ? 'ipv6' : 'ipv4'); } catch { return false; }
}

// Loopback = lokale ontwikkeling (`netlify dev`): daar ziet de server nooit het echte publieke IP,
// dus behandelen we het als intern zodat je lokaal de volledige weergave krijgt. In productie stuurt
// Netlify altijd het publieke bezoekers-IP door (nooit loopback), dus dit is geen lek.
function isLoopback(ip) {
  return ip === '::1' || ip === '127.0.0.1' || /^127\./.test(ip);
}

// Bepaal de tier uit het IP en de netwerklijsten. Intern wint van gast wint van publiek.
export function resolveTier(ip, networks = {}) {
  if (isLoopback(ip)) return 'internal';
  if (inList(ip, parseList(networks.intern))) return 'internal';
  if (inList(ip, parseList(networks.gast)))   return 'guest';
  return 'public';
}

// Haal de wifi-CIDR-lijsten (kenmerk 000157/000158) op via de Query-WFL (GET_SPACE_NETWORKS).
export async function fetchNetworks(base, spaceId, { apiKey, appQuery, action = 'GET_SPACE_NETWORKS' }) {
  const res = await fetch(`${base}/action/_rest_QueryAtalianJobs`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', ApiKey: apiKey, ApplicationElementId: appQuery },
    body: JSON.stringify({ Action: action, SpaceId: spaceId }),
  });
  if (!res.ok) return { intern: [], gast: [] };
  const body = await res.json().catch(() => ({}));
  const s = body?.properties?.Output?.object;
  let txt = s ? String(s).trim().replace(/^'(.*)'$/, '$1').replace(/&quot;/g, '"') : '';
  if (!txt || txt === '{}') return { intern: [], gast: [] };
  try {
    const obj = JSON.parse(txt);
    return { intern: parseList(obj.intern), gast: parseList(obj.gast) };
  } catch {
    return { intern: [], gast: [] };
  }
}

// Rang van de tiers (hoger = meer toegang). Gebruikt door de veilige test-override.
const TIER_RANK = { public: 0, guest: 1, internal: 2 };

// Een ?tier=-parameter mag de tier enkel AFSCHALEN, nooit ophogen (zo blijft het onmogelijk om
// via de URL méér te zien; het is puur een testhulp om de light/gast-versie te bekijken).
function applyDowngrade(event, resolved) {
  const req = String((event.queryStringParameters || {}).tier || '').toLowerCase();
  if (!(req in TIER_RANK)) return resolved;
  return TIER_RANK[req] < TIER_RANK[resolved] ? req : resolved;
}

// Alles-in-één: IP bepalen, netwerken ophalen, tier teruggeven. Faalt altijd veilig naar 'public'
// (bij fout of ontbrekende config ziet de bezoeker enkel de light-versie — nooit onbedoeld meer).
export async function resolveSpaceTier(event, { base, spaceId, apiKey, appQuery }) {
  const ip = clientIp(event);
  // Lokale ontwikkeling (`netlify dev`): geen echt publiek IP beschikbaar → standaard intern,
  // zodat je lokaal de volledige weergave ziet. ?tier=public|guest schaalt lokaal gewoon af.
  const devDefault = process.env.NETLIFY_DEV === 'true' ? 'internal' : 'public';
  if (!spaceId || !base || !apiKey || !appQuery) return { tier: applyDowngrade(event, devDefault), ip, networks: { intern: [], gast: [] } };
  try {
    const networks = await fetchNetworks(base, spaceId, { apiKey, appQuery });
    const resolved = resolveTier(ip, networks);
    return { tier: applyDowngrade(event, resolved === 'public' ? devDefault : resolved), ip, networks };
  } catch {
    return { tier: applyDowngrade(event, devDefault), ip, networks: { intern: [], gast: [] } };
  }
}
