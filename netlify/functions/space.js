export async function handler(event) {
  // Haal spaceId op uit querystring
  const spaceId = event.queryStringParameters.spaceId;
  console.log("🛠️ Ontvangen spaceId:", spaceId);

  // Controleer of spaceId is meegegeven
  if (!spaceId || spaceId.trim() === '') {
    console.error("❌ Geen spaceId opgegeven.");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Er werd geen spaceId meegegeven in de URL.' })
    };
  }

  const API_KEY = 'E8CE6F5E76BE4925AE352310A6871B95'; // <-- vervang door je echte key
  const url = `https://atalian-test.ultimo.net/api/v1/object/Space('${spaceId}')`;

  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        ApiKey: API_KEY
      }
    });

    const text = await res.text(); // vang ook foutmeldingen op
    console.log("🛰️ Respons van Ultimo:", text);

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: text })
      };
    }

    const data = JSON.parse(text);

    return {
      statusCode: 200,
      body: JSON.stringify({
        description: data.Description ?? '(geen beschrijving beschikbaar)'
      })
    };
  } catch (err) {
    console.error("💥 Fout in fetch:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
