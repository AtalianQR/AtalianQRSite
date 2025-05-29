// netlify/functions/Equipment.js
export async function handler(event) {
  // verwachte query-param is: ?equipmentId=000123
  const equipmentId = event.queryStringParameters.equipmentId;
  const API_KEY = "235A210503214055A27F070DB8748750";
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
    // geef alleen de beschrijving van het asset-type terug
    return {
      statusCode: 200,
      body: JSON.stringify({ typeDescr: data.EquipmentTypeDescr })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
