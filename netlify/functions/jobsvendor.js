// netlify/functions/jobsvendor.js

const API_KEY       = process.env.ULTIMO_API_KEY;
const BASE_URL      = process.env.ULTIMO_API_BASEURL;
const APP_ELEMENT   = process.env.APP_ELEMENT_QueryAtalianJobs;
const ULTIMO_ACTION = "_rest_QueryAtalianJobs";

/* ───────────── Helpers ───────────── */
const stripHtml = (s = "") =>
  String(s).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s{2,}/g, " ").trim();

const getDomain = (e = "") => {
  const m = String(e).toLowerCase().match(/@(.+)$/);
  return m ? m[1] : "";
};

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

  // 1. Ultimo API gaf een foutstatus (bijv. 401, 404, 500)
  if (!res.ok) {
    return { ok: false, status: res.status, text: await res.text() };
  }
  
  // 2. Status is OK (bijv. 200), maar we controleren of de response JSON is (defensief).
  const contentType = res.headers.get('content-type');
  
  if (contentType && contentType.includes('application/json')) {
    try {
      // Vangt de crash op als de response 'application/json' claimt, maar ongeldig is.
      return { ok: true, json: await res.json() };
    } catch (e) {
      // Dit resulteert in een 502 Bad Gateway/API Error (geen 500 Internal Server Error)
      return { ok: false, status: 502, text: `502: Ongeldige JSON respons van Ultimo API: ${e.message}` };
    }
  } 
  
  // 3. Vangt een 200 OK status op die geen JSON is (bijvoorbeeld een lege body/tekst van de Test API).
  const text = await res.text();
  return { ok: false, status: 502, text: `502: Ultimo gaf OK status maar geen JSON terug: ${text.substring(0, 100)}...` };
}

/** * Output.object kan "true"/"false", JSON-string ({QRCommando, Jobs:[...]}), 
 * of de ruwe Base64-string zijn (voor GET_JOB_DOC).
 */
function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  const txt = String(s).trim();
  
  if (txt === "true" || txt === "false") return txt;

  // Probeer alleen JSON te parsen als het de typische JSON structuur is ({...})
  if (txt.startsWith('{') && txt.endsWith('}')) {
    try {
      return JSON.parse(txt);
    } catch (e) {
      // Als parsen faalt, behandelen we de string als ruwe data
    }
  }
  
  // Als het geen geldige JSON is, retourneren we de ruwe string (dit is de Base64 data)
  return txt;
}

function pickFirstJob(out) {
  if (!out || typeof out !== "object") return null;
  if (!Array.isArray(out.Jobs)) return null;
  return out.Jobs[0] || null;
}

function pickDocuments(out) {
  if (!out || typeof out !== "object") return [];
  return Array.isArray(out.Documents) ? out.Documents : [];
}


/* ───────────── Handler ───────────── */
export async function handler(event) {
  try {
    /* ───────────── GET ───────────── */
    if (event.httpMethod === "GET") {
      // docId toegevoegd
      const { jobId, email = "", action = "VIEW", controle, docId } = event.queryStringParameters || {};
      
      // 0) Eén specifiek Document opvragen (ENKEL met docId / objdocid)
      if (action === "GET_JOB_DOC") {
        // *** JobId is niet nodig voor de API call (zoals gevraagd). ***
        if (!docId || !/^\d+$/.test(docId)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Ongeldig of ontbrekend 'docId' (objdocid)." }) };
        }
        
        // Call gebruikt de juiste parameter: objdocid
        const r = await callUltimo({
          Action: "GET_JOB_DOC", 
          objdocid: String(docId), 
        });

        if (!r.ok) return { statusCode: r.status, body: r.text };

        // out zal nu de ruwe Base64 string bevatten
        const out = getOutputObject(r.json);
        
        // Retourneert de Base64-string in de Document property
        return {
          statusCode: 200,
          body: JSON.stringify({ docId: String(docId), Document: out }),
        };
      }
      
      // 1) Alle Documents van een Job opvragen
      // JobId is weer vereist om WorkflowException te omzeilen.
      if (action === "LIST_JOB_DOCS") {
        if (!jobId || !/^\d+$/.test(jobId)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Ongeldig of ontbrekend 'jobId'." }) };
        }
        // JobId weer meegestuurd
        const r = await callUltimo({ Action: "LIST_JOB_DOCS", JobId: String(jobId) });
        if (!r.ok) return { statusCode: r.status, body: r.text };

        const out = getOutputObject(r.json);
        const docs = pickDocuments(out);
        return { statusCode: 200, body: JSON.stringify({ jobId: String(jobId), Documents: docs }) };
      }
      

      // 2) Dedicated controle-pad voor frontend login
      if (controle) {
        if (!jobId || !/^\d+$/.test(jobId)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Ongeldig of ontbrekend 'jobId'." }) };
        }
        // ... rest van de code blijft hetzelfde, want deze delen werken correct.
        // Eerst job ophalen om Vendor.EmailAddress te kennen (VIEW)
        const view = await callUltimo({ JobId: String(jobId), Email: email || "", Action: "VIEW" });
        if (!view.ok) return { statusCode: view.status, body: view.text };

        const vOut = getOutputObject(view.json);
        const job = pickFirstJob(vOut);
        const vendorEmail =
          job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";

        // Dan de pure controle-call (workflow vergelijkt enkel domeinen en geeft true/false)
        const payload = {
          JobId: String(jobId),
          Email: email || "",
          Controle: String(controle),
          ControleDomain: getDomain(controle),
          LoginDomain: getDomain(email),
          VendorDomain: getDomain(vendorEmail),
          Action: "VIEW",
        };

        const chk = await callUltimo(payload);
        if (!chk.ok) return { statusCode: chk.status, body: chk.text };

        const out = getOutputObject(chk.json);
        const allowed = String(out).toLowerCase() === "true";
        return { statusCode: 200, body: JSON.stringify({ allowed }) };
      }

      // 3) Standaard VIEW (geen side-effects)
      if (!jobId || !/^\d+$/.test(jobId)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Ongeldig of ontbrekend 'jobId'." }) };
      }

      const r = await callUltimo({ JobId: String(jobId), Email: email || "", Action: action });
      if (!r.ok) return { statusCode: r.status, body: r.text };

      const out = getOutputObject(r.json);
      const job = pickFirstJob(out);
      if (!job) return { statusCode: 404, body: JSON.stringify({ error: "Job niet gevonden." }) };

      if (job.Description) job.Description = stripHtml(job.Description);

      return {
        statusCode: 200,
        body: JSON.stringify({ jobId: String(jobId), email: email || null, Job: job, hasDetails: true }),
      };
    }

    /* ───────────── POST ───────────── */
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, jobId, email = "", text = "" } = body || {};

      if (!jobId || !/^\d+$/.test(jobId)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Ongeldig of ontbrekend 'jobId'." }) };
      }
      if (!action || !["ADD_INFO", "CLOSE"].includes(action)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Ongeldige of ontbrekende 'action'." }) };
      }

      // Server-side guard: eerst job ophalen → domeinen doorgeven → controle vragen
      const firstView = await callUltimo({ JobId: String(jobId), Email: email || "", Action: "VIEW" });
      if (!firstView.ok) return { statusCode: firstView.status, body: firstView.text };

      const vOut = getOutputObject(firstView.json);
      const job = pickFirstJob(vOut);
      const vendorEmail =
        job?.VendorEmailAddress || job?.Vendor?.EmailAddress || "";

      const checkPayload = {
        JobId: String(jobId),
        Email: email || "",
        Controle: email || "",
        ControleDomain: getDomain(email),
        LoginDomain: getDomain(email),
        VendorDomain: getDomain(vendorEmail),
        Action: "VIEW",
      };
      const chk = await callUltimo(checkPayload);
      if (!chk.ok) return { statusCode: chk.status, body: chk.text };

      const outChk = getOutputObject(chk.json);
      const allowed = String(outChk).toLowerCase() === "true";
      if (!allowed) {
        return { statusCode: 403, body: JSON.stringify({ error: "E-mailadres niet toegestaan voor deze job/leverancier." }) };
      }

      // Doorsturen mutatie
      const ultPayload =
        action === "ADD_INFO"
          ? { JobId: String(jobId), Email: email, Action: "ADD_INFO", Text: String(text || "") }
          : { JobId: String(jobId), Email: email, Action: "CLOSE",    Text: String(text || "") };

      const r = await callUltimo(ultPayload);
      if (!r.ok) return { statusCode: r.status, body: r.text };

      return { statusCode: 200, body: JSON.stringify({ ok: true, jobId, action }) };
    }

    return { statusCode: 405, body: "Methode niet toegestaan" };
  } catch (err) {
    console.error("jobsvendor error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}