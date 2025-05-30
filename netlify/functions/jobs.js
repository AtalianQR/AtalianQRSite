// netlify/functions/jobs.js

export async function handler(event) {
  const { type, id, lang } = event.queryStringParameters || {};

  if (!type || !id) {
    console.error("Missing 'type' or 'id'");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'type' or 'id' parameter." }),
    };
  }

  const API_KEY = "235A210503214055A27F070DB8748750";
  const APPLICATION_ELEMENT_ID = "5228BD891DFF45BB85ECF251086B2669";
  const url = "https://atalian-test.ultimo.net/api/v1/action/_rest_QueryAtalianJobs";

  const payload = {
    SpaceId: type === "sp" ? id : "",
    EquipmentId: type === "eq" ? id : "",
  };

  console.log("POST body:", JSON.stringify(payload));
  console.log(
    `cURL command: curl -X POST "${url}" -H "accept: application/json" -H "ApiKey: ${API_KEY}" -H "Content-Type: application/json" -H "ApplicationElementId: ${APPLICATION_ELEMENT_ID}" -d '${JSON.stringify(
      payload
    )}'`
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ApiKey: API_KEY,
        ApplicationElementId: APPLICATION_ELEMENT_ID,
      },
      body: JSON.stringify(payload),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultimo error response:", errorText);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: errorText }),
      };
    }

    const data = await response.json();

    // The workflow now returns a JsonContainer with a 'jobs' array
    let jobs = [];
    if (data.Output && Array.isArray(data.Output.jobs)) {
      jobs = data.Output.jobs;
    } else {
      console.warn("No jobs array in workflow response:", data.Output);
    }

    console.log("Jobs returned:", jobs.length);

    return {
      statusCode: 200,
      body: JSON.stringify(jobs),
    };
  } catch (err) {
    console.error("Catch error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
