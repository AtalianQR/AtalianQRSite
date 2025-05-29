export async function handler(event) {
  const spaceId = event.queryStringParameters.spaceId;
  const API_KEY = "E8CE6F5E76BE4925AE352310A6871B95";
  const url = `https://atalian-test.ultimo.net/api/v1/object/Space('${spaceId}')`;

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
      body: JSON.stringify({ description: data.Description })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
