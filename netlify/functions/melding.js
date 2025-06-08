export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }
console.log('RECEIVED DATA:', event.body);
  const API_KEY = "03F5BDB822224699AD5077BE481BB627";
  const APPLICATION_ELEMENT_ID = "3f92bbfca30445ff875f3a9d956441be";
  const url = "https://atalian-test.ultimo.net/api/v1/action/_REST_OneAtalianJob";

  try {
    const data = JSON.parse(event.body);
    const { id, type, lang, JobDescr, ReportText } = data;

    // Validatie
    if (!id || !type || !JobDescr || !ReportText) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: id, type, JobDescr, or ReportText' })
      };
    }

    // Opbouw payload
    const payload = {
      JobDescr,
      ReportText
    };

    if (type === 'sp') {
      payload.SpaceId = id;
    } else if (type === 'eq') {
      payload.EquipmentId = id;
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Unknown type "${type}". Must be 'sp' or 'eq'.` })
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "ApiKey": API_KEY,
        "ApplicationElementId": APPLICATION_ELEMENT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    return {
      statusCode: response.status,
      body: text
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: `Serverfout: ${error.message}`
    };
  }
}
