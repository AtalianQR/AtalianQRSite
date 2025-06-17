import { API_KEY, BASE_URL } from "./APIConfig.js";

export async function handler(event) {
  const equipmentId = event.queryStringParameters.id;
  const url = `${BASE_URL}/object/Equipment('${equipmentId}')`;

  try {
    const res = await fetch(url, {
      headers: {
        "accept": "application/json",
        "ApiKey": API_KEY
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }

    const data = await res.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        description: data.Description || "Geen beschrijving gevonden."
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
