import fetch from "node-fetch";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const isTest =
      event.queryStringParameters?.test === "1" ||
      event.queryStringParameters?.env === "test";

    const baseUrl = isTest
      ? process.env.ULTIMO_TEST_BASE_URL
      : process.env.ULTIMO_PROD_BASE_URL;

    if (!baseUrl) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Configuratiefout",
          message: "ULTIMO_*_BASE_URL ontbreekt"
        })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Ongeldige JSON body" })
      };
    }

    const { jobId, fileName, description, base64 } = body;

    if (!jobId || !fileName || !base64) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Ontbrekende verplichte velden",
          required: ["jobId", "fileName", "base64"]
        })
      };
    }

    const ultimoPayload = {
      Action: "ADD_JOB_DOC",
      JobId: String(jobId),
      AddDoc_FileName: fileName,
      AddDoc_Description: (description || fileName).substring(0, 200),
      AddDoc_Base64: base64,
      AddDoc_FileSystemPathId: "001"
    };

    const url = new URL(
      "/action/_rest_QueryAtalianJobs",
      baseUrl
    ).toString();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ApiKey: process.env.ULTIMO_API_KEY,
        ApplicationElementId: process.env.ULTIMO_APP_ELEMENT_ID
      },
      body: JSON.stringify(ultimoPayload)
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Ultimo upload mislukt",
          ultimoResponse: text
        })
      };
    }

    return {
      statusCode: 200,
      body: text
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Serverfout in jobdocupload",
        message: err.message
      })
    };
  }
}
