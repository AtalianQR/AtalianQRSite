export async function handler(event) {
  const spaceId = event.queryStringParameters.id;

  if (!spaceId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Geen geldig ID ontvangen." }),
    };
  }

  const apiKey = "E8CE6F5E76BE4925AE352310A6871B95";
  const url = `https://atalian-test.ultimo.net/api/v1/object/Space('${spaceId}')`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        ApiKey: apiKey,
      },
    });

    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Fout bij ophalen van ruimte." }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify({
        description: data.Description || "Geen beschrijving gevonden.",
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Serverfout bij ophalen." }),
    };
  }
}
