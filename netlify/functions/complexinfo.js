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


exports.handler = async function (event) {
  try {
    // ============================================================
    // 1. METHOD CHECK
    // ============================================================
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        body: "Method not allowed",
      };
    }

    // ============================================================
    // 2. QUERYSTRING + ENVIRONMENT
    // ============================================================
    const qs = event.queryStringParameters || {};
    const env = qs.env === "test" ? "test" : "prod";

    const BASE_URL =
      env === "test"
        ? process.env.ULTIMO_API_BASEURL_TEST
        : process.env.ULTIMO_API_BASEURL;

    const API_KEY = process.env.ULTIMO_API_KEY;
    const APP_ELEMENT = process.env.APP_ELEMENT_QueryAtalianJobs;
    const ULTIMO_ACTION = "_rest_QueryAtalianJobs";

    if (!BASE_URL || !API_KEY || !APP_ELEMENT) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Serverconfig onvolledig: BASE_URL, API_KEY of APP_ELEMENT ontbreekt.",
        }),
      };
    }

    // ============================================================
    // 3. HELPERS
    // ============================================================
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
        return {
          ok: false,
          status: res.status,
          text: await res.text(),
        };
      }

      return {
        ok: true,
        json: await res.json(),
      };
    }

    function getOutputObject(raw) {
      const s = raw?.properties?.Output?.object;
      if (!s) return null;

      const txt = String(s)
        .replace(/&quot;/g, '"')
        .replace(/[\u0000-\u001F]+/g, " ")
        .replace(/\u2028|\u2029/g, " ")
        .trim();

      if (txt.startsWith("{") && txt.endsWith("}")) {
        try {
          return JSON.parse(txt);
        } catch (e) {
          return {
            error: "Output.object kon niet als JSON geparsed worden",
            details: String(e),
            preview: txt.slice(0, 800),
          };
        }
      }

      return txt;
    }

    // ============================================================
    // 4. PARAMETERS
    // ============================================================
    const action = (qs.action || "LIST_COMPLEX").toUpperCase();

    const complex = qs.complex || qs.ComplexSelector;
    const buildingFloorId = qs.buildingFloorId || qs.BuildingFloorId;
    const buildingId = qs.buildingId || qs.BuildingId;
    const buildingPartId = qs.buildingPartId || qs.BuildingPartId;

    const countryId = qs.CountryId || qs.countryId;
    const departmentId = qs.DepartmentId || qs.departmentId || "000793";

    // ============================================================
    // 5. PAYLOAD OPBOUWEN
    // ============================================================
    let payload;

    const actionsWithoutComplex = [
      "LIST_SPACES_BY_COUNTRY",
      "LIST_BUILDINGS_BY_COUNTRY",
      "LIST_BUILDINGS_BY_DEPARTMENT",
    ];

    // ------------------------------------------------------------
    // 5A. Generieke calls zonder complexSelector
    // ------------------------------------------------------------
    if (actionsWithoutComplex.includes(action)) {
      payload = {
        Action: action,
        DepartmentId: departmentId,
      };

      if (countryId) payload.CountryId = countryId;

      if (
        (action === "LIST_SPACES_BY_COUNTRY" ||
          action === "LIST_BUILDINGS_BY_COUNTRY") &&
        !countryId
      ) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "CountryId is verplicht voor deze action.",
          }),
        };
      }

      if (!departmentId) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "DepartmentId is verplicht voor deze action.",
          }),
        };
      }

    // ------------------------------------------------------------
    // 5B. Bestaande calls met complexSelector
    // ------------------------------------------------------------
    } else {
      if (!complex || !/^[SE]\d+$/.test(complex)) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Ongeldige complexSelector. Verwacht: Sxxxxxx of Exxxxxx",
          }),
        };
      }

      if (action === "LIST_FLOORS") {
        payload = {
          Action: "LIST_FLOORS",
          ComplexSelector: complex,
        };

      } else if (action === "LIST_FLOOR_SPACES") {
        if (!buildingFloorId) {
          return {
            statusCode: 400,
            body: JSON.stringify({
              error: "buildingFloorId is verplicht",
            }),
          };
        }

        payload = {
          Action: "LIST_FLOOR_SPACES",
          ComplexSelector: complex,
          BuildingFloorId: buildingFloorId,
        };

        if (buildingId) payload.BuildingId = buildingId;
        if (buildingPartId) payload.BuildingPartId = buildingPartId;

      } else {
        payload = {
          Action: action,
          ComplexSelector: complex,
        };
      }
    }

    // ============================================================
    // 6. CALL NAAR ULTIMO
    // ============================================================
    console.log("complexinfo payload:", payload);

    const r = await callUltimo(payload);

    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: r.text,
      };
    }

    // ============================================================
    // 7. OUTPUT PARSEN EN TERUGGEVEN
    // ============================================================
    const out = getOutputObject(r.json);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(out || { Items: [] }),
    };

  } catch (err) {
    // ============================================================
    // 8. ERROR HANDLING
    // ============================================================
    console.error("complexinfo error", err);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
};