const API_KEY   = process.env.ULTIMO_API_KEY;
const BASE_URL  = process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT = process.env.APP_ELEMENT_QueryAtalianJobs;


export async function handler(event) {
  /* ── 1. Query-params ophalen ─────────────────────────────────────── */
  const { type, id, code } = event.queryStringParameters || {};

  /* ── 2. Decode-blok voor 13-cijferige ‘code’ ─────────────────────── */
  let finalType = type;
  let finalId   = id;

  if (code) {
    if (!/^\d{13}$/.test(code)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Ongeldige code-parameter" }),
      };
    }
    const indicator = code.slice(-1);           // '9' → equipment, '0' → space
    finalType       = indicator === "9" ? "eq" : "sp";

    // oorspronkelijke 6-cijferige ID = posities 0,2,4,6,8,10
    finalId = code[0] + code[2] + code[4] + code[6] + code[8] + code[10];
  }

  /* ── 3. Valideer na decoderen ────────────────────────────────────── */
  if (!finalType || !finalId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'type' of 'id' parameter." }),
    };
  }

  /* ── 4. Payload voor Ultimo-API ──────────────────────────────────── */
  const payload = {
    SpaceId:     finalType === "sp" ? finalId : "",
    EquipmentId: finalType === "eq" ? finalId : "",
  };

  /* ── 5. Ultimo-call + verwerking ─────────────────────────────────── */

  // helper om HTML-tags en carets te strippen
  const stripHtmlTags = (txt = "") =>
    txt
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

  try {
    const url = `${BASE_URL}/action/_rest_QueryAtalianJobs`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ApiKey: API_KEY,
        ApplicationElementId: APP_ELEMENT,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Ultimo API error:", response.status, errText);
      return { statusCode: response.status, body: errText };
    }

    /* 5a. Parse Ultimo-response */
    const rawData   = await response.json();
    const rawString = rawData?.properties?.Output?.object;

    let jobs = [];
    let equipmentTypeQR = null;

    if (rawString) {
      const obj = JSON.parse(rawString);

      /* Jobs altijd als array */
      jobs = Array.isArray(obj.Jobs) ? obj.Jobs : [];

      /* EquipmentTypeQR clean-up (optional) */
      if (typeof obj.EquipmentTypeQR === "string") {
        const cleaned = stripHtmlTags(obj.EquipmentTypeQR).replace(/\^/g, '"');
        try { equipmentTypeQR = JSON.parse(cleaned); } catch {/* ignore */}
      }
    }

    /* ── 6. Succes-response ───────────────────────────────────────── */
    return {
      statusCode: 200,
      body: JSON.stringify({
        type : finalType,     // mee terug voor front-end (optioneel)
        id   : finalId,
        Jobs : jobs,
        EquipmentTypeQR: equipmentTypeQR,
        hasJobs: jobs.length > 0,
      }),
    };

  } catch (err) {
    console.error("Jobs Lambda Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

