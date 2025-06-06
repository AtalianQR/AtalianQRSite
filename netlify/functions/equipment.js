export async function handler(event) {
  const equipmentId = event.queryStringParameters.id;
  const API_KEY = "03F5BDB822224699AD5077BE481BB627";
  const url = `https://atalian-test.ultimo.net/api/v1/object/Equipment('${equipmentId}')`;

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
