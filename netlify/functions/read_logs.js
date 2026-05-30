// netlify/functions/read_logs.js
import { getStore } from '@netlify/blobs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

function respond(obj) {
  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

  try {
    // Stap 0: ping — bewijst dat de functie geladen en bereikbaar is
    const store = getStore('formlog');

    // Stap 1: list eerste pagina
    const page = await store.list();
    const blobs = page?.blobs ?? [];

    return respond({ ok: true, blobCount: blobs.length, sample: blobs.slice(0, 3) });

  } catch (err) {
    return respond({
      ok: false,
      error: err?.constructor?.name || 'Error',
      message: err?.message || String(err)
    });
  }
}
