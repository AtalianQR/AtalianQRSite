export async function handler(event) {
  const { type, id } = event.queryStringParameters || {};

  if (!type || !id) {
    console.error("Missing 'type' or 'id'");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'type' or 'id' parameter." }),
    };
  }

  const API_KEY = "03F5BDB822224699AD5077BE481BB627";
  const APPLICATION_ELEMENT_ID = "6379d9e0a70545a6d90679e46e6ab715";
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

    const rawData = await response.json();
    console.log("RECEIVED RAW DATA:", JSON.stringify(rawData, null, 2));

    let jobs = [];

    const rawString = rawData?.properties?.Output?.object;
    if (rawString) {
      try {
        jobs = JSON.parse(rawString);
      } catch (parseError) {
        console.error("Failed to parse Output.object as JSON:", parseError, rawString);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Invalid JSON returned by Ultimo.", raw: rawString }),
        };
      }
    } else {
      console.warn("Output.object was empty or missing:", rawData);
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
