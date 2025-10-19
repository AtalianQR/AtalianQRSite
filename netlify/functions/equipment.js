// netlify/functions/equipment.js
const API_KEY  = process.env.ULTIMO_API_KEY;
const BASE_URL = process.env.ULTIMO_API_BASEURL;
// Alleen gebruiken als je AppElements nodig hebt:
const APP_QUERY = process.env.APP_ELEMENT_QueryAtalianJobs;
const APP_ONE   = process.env.APP_ELEMENT_OneAtalianJob;

const json = (status, obj) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  },
  body: JSON.stringify(obj)
});

export async function handler(event) {
  const equipmentId = (event.queryStringParameters?.id ?? '').trim();
  if (!equipmentId) {
    return json(400, { description: '', error: "Geen geldig ID ontvangen." });
  }

  const url = `${BASE_URL}/object/Equipment('${equipmentId}')`;

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ApiKey: API_KEY }
    });

    if (res.status === 404) {
      return json(404, { description: "", error: `Installatie met ID ${equipmentId} niet gevonden.` });
    }
    if (!res.ok) {
      const txt = await res.text();
      return json(res.status, { description: "", error: "Fout bij ophalen van installatie.", detail: txt });
    }

    const data = await res.json();
    const desc = data?.Description
      ?? data?.description
      ?? data?.properties?.Description
      ?? data?.properties?.description
      ?? "Geen beschrijving gevonden.";

    return json(200, {
      description: desc,
      context: process.env.CONTEXT // 'production' | 'deploy-preview' | 'branch-deploy' (handig voor debug)
    });

  } catch (err) {
    return json(500, { description: "", error: "Serverfout bij ophalen.", detail: String(err?.message || err) });
  }
}
