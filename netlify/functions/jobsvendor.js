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
  if (!res.ok) {
    return { ok: false, status: res.status, text: await res.text() };
  }
  const json = await res.json();
  return { ok: true, json };
}

/** Output.object kan "true"/"false" of JSON-string met {QRCommando, Jobs:[...]} zijn */
function getOutputObject(raw) {
  const s = raw?.properties?.Output?.object;
  if (!s) return null;
  const txt = String(s).trim();
  if (txt === "true" || txt === "false") return txt;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
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
      const { jobId, email = "", action = "VIEW", controle } = event.queryStringParameters || {};
	  
		// 0) Documents van een Job opvragen
		if (action === "LIST_JOB_DOCS") {
		  if (!jobId || !/^\d+$/.test(jobId)) {
			return { statusCode: 400, body: JSON.stringify({ error: "Invalid or missing 'jobId'." }) };
		  }
		  const r = await callUltimo({ Action: "LIST_JOB_DOCS", JobId: String(jobId) });
		  if (!r.ok) return { statusCode: r.status, body: r.text };

		  const out = getOutputObject(r.json);
		  const docs = pickDocuments(out);
		  return { statusCode: 200, body: JSON.stringify({ jobId: String(jobId), Documents: docs }) };
		}
	  

      // 1) Dedicated controle-pad voor frontend login
      if (controle) {
        if (!jobId || !/^\d+$/.test(jobId)) {
          return { statusCode: 400, body: JSON.stringify({ error: "Invalid or missing 'jobId'." }) };
        }

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

      // 2) Standaard VIEW (geen side-effects)
      if (!jobId || !/^\d+$/.test(jobId)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid or missing 'jobId'." }) };
      }

      const r = await callUltimo({ JobId: String(jobId), Email: email || "", Action: action });
      if (!r.ok) return { statusCode: r.status, body: r.text };

      const out = getOutputObject(r.json);
      const job = pickFirstJob(out);
      if (!job) return { statusCode: 404, body: JSON.stringify({ error: "Job not found." }) };

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
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid or missing 'jobId'." }) };
      }
      if (!action || !["ADD_INFO", "CLOSE"].includes(action)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid or missing 'action'." }) };
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
        return { statusCode: 403, body: JSON.stringify({ error: "Email not allowed for this job/vendor." }) };
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

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    console.error("jobsvendor error", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
