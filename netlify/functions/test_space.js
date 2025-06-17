import { API_KEY, BASE_URL } from "./APIConfig_test.js";

export async function handler(event) {
  const { id: spaceId } = event.queryStringParameters || {};

  if (!spaceId) {
    console.error("Missing 'id' parameter");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Geen geldig ID ontvangen." }),
    };
  }

  const url = `${BASE_URL}/object/Space('${spaceId}')`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        ApiKey: API_KEY,
      },
    });

    // Specifieke handling als de ruimte niet bestaat (meestal 404)
    if (response.status === 404) {
      console.warn(`Ruimte met ID ${spaceId} niet gevonden.`);
      return {
        statusCode: 404,
        body: JSON.stringify({
          description: "",
          error: `Ruimte met ID ${spaceId} niet gevonden.`,
        }),
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultimo API returned non-200:", response.status, errorText);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          description: "",
          error: "Fout bij ophalen van ruimte.",
          detail: errorText,
        }),
      };
    }

    const data = await response.json();
    // Probeer zowel direct als binnen properties de beschrijving te vinden
    let beschrijving = data.Description || data.description || "";
    if (!beschrijving && data.properties) {
      beschrijving =
        data.properties.Description || data.properties.description || "";
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        description: beschrijving || "Geen beschrijving gevonden.",
        error: "", // expliciet leeg voor consistente frontend-afhandeling
      }),
    };
  } catch (error) {
    console.error("Serverfout bij ophalen:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        description: "",
        error: "Serverfout bij ophalen.",
        detail: error.message,
      }),
    };
  }
}
