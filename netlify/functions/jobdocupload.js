import fetch from "node-fetch";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");

    const {
      jobId,
      fileName,
      description,
      base64,
      env
    } = body;

    if (!jobId || !fileName || !base64) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Ontbrekende verplichte velden",
          required: ["jobId", "fileName", "base64"]
        })
      };
    }

    // 👉 ZELFDE ENV-CONTRACT ALS jobsvendor.js
    const isTest = env === "test";

    const baseUrl = isTest
      ? process.env.ULTIMO_API_BASEURL_TEST
      : process.env.ULTIMO_API_BASEURL;

    if (!baseUrl) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Configuratiefout",
          message: "ULTIMO_API_BASEURL(_TEST) ontbreekt"
        })
      };
    }

    const ultimoPayload = {
      Action: "ADD_JOB_DOC",
      JobId: String(jobId),
      AddDoc_FileName: fileName,
      AddDoc_Description: description || fileName,
      AddDoc_Base64: base64,
      AddDoc_FileSystemPathId: "001" // standaard job-documentpad
    };

    const response = await fetch(
      `${baseUrl}/action/_rest_QueryAtalianJobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ApiKey: process.env.ULTIMO_API_KEY,
          ApplicationElementId: process.env.ULTIMO_APP_ELEMENT_ID
        },
        body: JSON.stringify(ultimoPayload)
      }
    );

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
