// complexinfo.js — LIST_COMPLEX / LIST_FLOORS / LIST_FLOOR_SPACES (+ generieke actions)

const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL      = process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT   = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION = "_rest_QueryAtalianJobs";

async function callUltimo(payload) {
  const res = await fetch(`${BASE_URL}/action/${ULTIMO_ACTION}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      ApiKey: API_KEY,
      ApplicationElementId: APP_ELEMENT,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, text: await res.text() };
  }
  return { ok: true, json: await res.json() };
}

function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;

  const txt = String(s).trim();
  if (txt.startsWith("{") && txt.endsWith("}")) {
    try { return JSON.parse(txt); } catch (e) {}
  }
  return txt;
}


export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const qs  = event.queryStringParameters || {};
    const env = qs.env === "test" ? "test" : "prod";

    // ⬅️ FIX: BASE_URL juist bepalen, en slechts één keer declareren
    const BASE_URL =
      env === "test"
        ? process.env.ULTIMO_API_BASEURL_TEST
        : process.env.ULTIMO_API_BASEURL;

    const API_KEY       = process.env.ULTIMO_API_KEY;
    const APP_ELEMENT   = process.env.APP_ELEMENT_QueryAtalianJobs;
    const ULTIMO_ACTION = "_rest_QueryAtalianJobs";

    async function callUltimo(payload) {
      const res = await fetch(`${BASE_URL}/action/${ULTIMO_ACTION}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          ApiKey: API_KEY,
          ApplicationElementId: APP_ELEMENT,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        return { ok: false, status: res.status, text: await res.text() };
      }
      return { ok: true, json: await res.json() };
    }

    function getOutputObject(raw) {
      const s = raw?.properties?.Output?.object;
      if (!s) return null;

      const txt = String(s).trim();
      if (txt.startsWith("{") && txt.endsWith("}")) {
        try { return JSON.parse(txt); } catch (e) {}
      }
      return txt;
    }

    const complex         = qs.complex;
    const action          = (qs.action || "LIST_COMPLEX").toUpperCase();
    const buildingFloorId = qs.buildingFloorId;
    const buildingId      = qs.buildingId;
    const buildingPartId  = qs.buildingPartId;

    if (!complex || !/^[SE]\d+$/.test(complex)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Ongeldige complexSelector. Verwacht: Sxxxxxx of Exxxxxx",
        }),
      };
    }

    // Payload opbouwen
    let payload;

    if (action === "LIST_FLOORS") {
      payload = {
        Action: "LIST_FLOORS",
        ComplexSelector: complex,
      };

    } else if (action === "LIST_FLOOR_SPACES") {
      if (!buildingFloorId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "buildingFloorId is verplicht" }),
        };
      }

      payload = {
        Action: "LIST_FLOOR_SPACES",
        ComplexSelector: complex,
        BuildingFloorId: buildingFloorId,
      };

      if (buildingId)      payload.BuildingId = buildingId;
      if (buildingPartId)  payload.BuildingPartId = buildingPartId;

    } else {
      payload = {
        Action: action,
        ComplexSelector: complex,
      };
    }

    const r = await callUltimo(payload);

    if (!r.ok) {
      return { statusCode: r.status, body: r.text };
    }

    const out = getOutputObject(r.json);
    return {
      statusCode: 200,
      body: JSON.stringify(out || { Items: [] }),
    };

  } catch (err) {
    console.error("complexinfo error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

