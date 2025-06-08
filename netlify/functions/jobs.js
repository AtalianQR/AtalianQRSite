import { API_KEY, BASE_URL, APP_ELEMENT_QueryAtalianJobs } from "./APIConfig.js";

export async function handler(event) {
  const { type, id } = event.queryStringParameters || {};

  if (!type || !id) {
    console.error("Missing 'type' or 'id'");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'type' or 'id' parameter." }),
    };
  }

  const url = `${BASE_URL}/action/_rest_QueryAtalianJobs`;

  const payload = {
    SpaceId: type === "sp" ? id : "",
    EquipmentId: type === "eq" ? id : "",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ApiKey: API_KEY,
        ApplicationElementId: APP_ELEMENT_QueryAtalianJobs,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: errorText }),
      };
    }

    const rawData = await response.json();

    let jobs = [];

    const rawString = rawData?.properties?.Output?.object;
    if (rawString) {
      try {
        jobs = JSON.parse(rawString);
      } catch (parseError) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Invalid JSON returned by Ultimo.", raw: rawString }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(jobs),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
