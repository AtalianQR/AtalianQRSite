export async function handler(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  const API_KEY = "235A210503214055A27F070DB8748750";
  const APPLICATION_ELEMENT_ID = "3f92bbfca30445ff875f3a9d956441be";
  const url = "https://atalian-test.ultimo.net/api/v1/action/_REST_OneAtalianJob";

  try {
    const data = JSON.parse(event.body);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "ApiKey": API_KEY,
        "ApplicationElementId": APPLICATION_ELEMENT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
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
