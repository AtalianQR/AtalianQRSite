const API_KEY   = process.env.ULTIMO_API_KEY;
const BASE_URL  = process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT = process.env.APP_ELEMENT_QueryAtalianJobs;

export async function handler(event) {
  // ── 1. Query-params ophalen ───────────────────────────────────────
  const { type, id, code } = event.queryStringParameters || {};

  // ── 2. Decode-blok voor 13-cijferige ‘code’ ───────────────────────
  let finalType = type;
  let finalId   = id;

  if (code) {
    if (!/^\d{13}$/.test(code)) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: "Ongeldige code-parameter" }),
      };
    }
    const indicator = code.slice(-1);           // '9' → equipment, '0' → space
    finalType       = indicator === "9" ? "eq" : "sp";

    // oorspronkelijke 6-cijferige ID = posities 0,2,4,6,8,10
    finalId = code[0] + code[2] + code[4] + code[6] + code[8] + code[10];
  }

  // ── 3. Valideer na decoderen ──────────────────────────────────────
  if (!finalType || !finalId) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: "Missing 'type' of 'id' parameter." }),
    };
  }

  // ── 4. Payload voor Ultimo-API ────────────────────────────────────
  const payload = {
    SpaceId:     finalType === "sp" ? finalId : "",
    EquipmentId: finalType === "eq" ? finalId : "",
  };

  // ── 5. Ultimo-call + verwerking ───────────────────────────────────
  const stripHtmlTags = (txt = "") =>
    String(txt)
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
      const errText = await response.text().catch(() => '');
      console.error("Ultimo API error:", response.status, errText);
      return {
        statusCode: response.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          error: "Ultimo API error",
          status: response.status,
          details: errText.slice(0, 800)
        })
      };
    }

    // 5a. Parse Ultimo-response (kan &quot; bevatten)
    const rawData   = await response.json();
    const rawString = rawData?.properties?.Output?.object;

    if (rawString == null) {
      return {
        statusCode: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: "Ultimo Output.object ontbreekt" })
      };
    }

	// Output.object is meestal een JSON-string met HTML entities (&quot;)
	const normalized = typeof rawString === "string"
	  ? rawString.replace(/&quot;/g, '"')
	  : JSON.stringify(rawString);

	// 🛡️ Nieuw: agressief normaliseren van control chars / line separators
	const cleaned = normalized
	  .replace(/[\u0000-\u001F]+/g, ' ')  // NUL..US (incl. \n, \r, \t), veilig naar spatie
	  .replace(/\u2028|\u2029/g, ' ')     // Unicode line/para separators → spatie
	  .replace(/\r?\n|\r/g, ' ')          // extra zekerheid op CR/LF
	  .replace(/\s{2,}/g, ' ')            // dubbele spaties samenvoegen
	  .trim();

	let obj;
	
	try {
	  obj = JSON.parse(cleaned);
	} catch (e) {
	  return {
		statusCode: 502,
		headers: { 'content-type': 'application/json; charset=utf-8' },
		body: JSON.stringify({
		  error: "Malformed JSON from Ultimo Output.object",
		  details: String(e),
		  // toon de 'cleaned' versie zodat je geen control chars in de preview ziet
		  preview: cleaned.slice(0, 800)
		})
	  };
	}


    // 5b. Velden extraheren (met defaults)
    const jobs = Array.isArray(obj.Jobs) ? obj.Jobs : [];
    const complexSvc = Array.isArray(obj.ComplexServiceWO) ? obj.ComplexServiceWO : [];
    const qr = typeof obj.QRCommando === "string" ? obj.QRCommando : "";

    // Optional: EquipmentTypeQR clean-up (indien aanwezig in payload)
    let equipmentTypeQR = null;
    if (typeof obj.EquipmentTypeQR === "string") {
      const cleaned = stripHtmlTags(obj.EquipmentTypeQR).replace(/\^/g, '"');
      try { equipmentTypeQR = JSON.parse(cleaned); } catch {/* ignore */}
    }

    // ── 6. Succes-response ─────────────────────────────────────────
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        type : finalType,
        id   : finalId,
        Jobs : jobs,
        ComplexServiceWO: complexSvc,
        QRCommando: qr,
        EquipmentTypeQR: equipmentTypeQR,
        hasJobs: jobs.length > 0
      }),
    };

  } catch (err) {
    console.error("Jobs Lambda Error:", err);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: err.message })
    };
  }
}