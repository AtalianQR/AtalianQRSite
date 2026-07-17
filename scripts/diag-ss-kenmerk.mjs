#!/usr/bin/env node
// Diagnose: valideert de SoundsensingID-kenmerken (000162) op alle installaties.
// - Werkt de ObjectFeature/Kenmerk-query? (GET_EQUIPMENT_BY_SERIAL met een gekend device)
// - Hebben alle Kenmerken een correct 36-teken UUID? (typo's breken inbound + resolve stil)
// - Staat elk Kenmerk-UUID ook effectief als device_id in Soundsensing?
// Draai met:  npx netlify dev:exec node scripts/diag-ss-kenmerk.mjs        (TEST)
//   PROD:     $env:BACKFILL_TARGET="prod"; npx netlify dev:exec node scripts/diag-ss-kenmerk.mjs
const PROD = process.argv.includes('--prod') || process.env.BACKFILL_TARGET === 'prod';
const ULTIMO_API_KEY = process.env.ULTIMO_API_KEY;
const APP_QUERY = process.env.APP_ELEMENT_QueryAtalianJobs;
const SOUNDSENSING_API_KEY = process.env.SOUNDSENSING_API_KEY;
const ULTIMO_BASE = PROD
  ? (process.env.ULTIMO_API_BASEURL || 'https://atalian.ultimo.net/api/v1')
  : (process.env.ULTIMO_API_BASEURL_TEST || 'https://atalian-test.ultimo.net/api/v1');

const KNOWN_UUID = '6305c036-7c34-4ecf-b472-9fd11ba6ca10'; // hoort bij installatie 021257
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ultimo(action, extra = {}) {
  const res = await fetch(`${ULTIMO_BASE}/action/_rest_QueryAtalianJobs`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', ApiKey: ULTIMO_API_KEY, ApplicationElementId: APP_QUERY },
    body: JSON.stringify({ Action: action, ...extra }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${action} HTTP ${res.status}: ${text.slice(0, 200)}`);
  let obj = JSON.parse(text)?.properties?.Output?.object ?? text;
  if (typeof obj === 'string') obj = JSON.parse(obj.replace(/^'|'$/g, '') || '{}');
  return obj;
}

async function soundsensingDeviceIds() {
  if (!SOUNDSENSING_API_KEY) return null;
  const res = await fetch('https://api.soundsensing.no/v1/alarm', { headers: { Authorization: `Bearer ${SOUNDSENSING_API_KEY}` } });
  if (!res.ok) return null;
  const body = await res.json();
  const items = Array.isArray(body?.data) ? body.data : (body?.data ? [body.data] : []);
  return new Set(items.map((a) => a.device_id));
}

async function main() {
  console.log(`Omgeving=${PROD ? 'PROD' : 'TEST'} (${ULTIMO_BASE})\n`);

  const eq = await ultimo('GET_EQUIPMENT_BY_SERIAL', { SerialNumber: KNOWN_UUID });
  console.log(`GET_EQUIPMENT_BY_SERIAL(${KNOWN_UUID.slice(0, 8)}...) -> EquipmentId=${eq.EquipmentId || '(geen)'}\n`);

  const { devices = [] } = await ultimo('LIST_SS_DEVICES');
  const alarmDevices = await soundsensingDeviceIds();
  console.log(`Installaties met Kenmerk 000162: ${devices.length}\n`);

  let bad = 0;
  for (const d of devices) {
    const uuid = String(d.DeviceUuid || '');
    const flags = [];
    if (!UUID_RE.test(uuid)) flags.push(`ONGELDIG FORMAAT (${uuid.length} tekens)`);
    if (alarmDevices && uuid && !alarmDevices.has(uuid)) flags.push('geen alarmen in Soundsensing (kan normaal zijn)');
    const mark = flags.length ? '  <-- ' + flags.join('; ') : '';
    if (flags.some((f) => f.startsWith('ONGELDIG'))) bad++;
    console.log(`  ${d.EquipmentId}  ${uuid}${mark}`);
  }
  console.log(`\n${bad} installatie(s) met een ONGELDIG UUID-formaat in het Kenmerk${bad ? ' -> corrigeren in Ultimo!' : ''}`);
}
main().catch((e) => { console.error('FOUT:', e.message); process.exit(1); });
