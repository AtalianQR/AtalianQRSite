import { API_KEY, BASE_URL, APP_ELEMENT_QueryAtalianJobs } from "./APIConfig.js";

export async function handler(event) {
  const { type, id } = event.queryStringParameters || {};

  function stripHtmlTags(input) {
    if (!input) return '';
    // Verwijder tags zoals <div> en HTML entities als &nbsp; en overbodige whitespace
    return input
      .replace(/<[^>]*>/g, '')     // strip alle HTML-tags
      .replace(/&nbsp;/g, ' ')     // vervang &nbsp; door spatie
      .replace(/\s{2,}/g, ' ')     // dubbele spaties weg
      .replace(/^\s+|\s+$/g, '');  // trim whitespace
  }

  if (!type || !id) {
    console.error("Missing 'type' or 'id'");
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'type' of 'id' parameter." }),
    };
  }

  const url = `${BASE_URL}/action/_rest_QueryAtalianJobs`;

  const payload = {
    SpaceId: type === "sp" ? id : "",
    EquipmentId: type === "eq" ? id : "",
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        ApiKey: API_KEY,
        ApplicationElementId: APP_ELEMENT_QueryAtalianJobs,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ultimo API returned non-200:", response.status, errorText);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: errorText }),
      };
    }

    const rawData = await response.json();
    const rawString = rawData?.properties?.Output?.object;

    let obj = {};
    let jobs = [];
    let equipmentTypeQR = null;

    if (rawString) {
      try {
        obj = JSON.parse(rawString);

        // Jobs altijd als array, ook als leeg
        jobs = Array.isArray(obj.Jobs) ? obj.Jobs : [];

        // EquipmentTypeQR: indien string, strip html + vervang carets en parse
        if (obj.EquipmentTypeQR && typeof obj.EquipmentTypeQR === "string") {
          let cleaned = stripHtmlTags(obj.EquipmentTypeQR);
          cleaned = cleaned.replace(/\^/g, '"');
          cleaned = cleaned.trim();
          try {
            equipmentTypeQR = JSON.parse(cleaned);
          } catch (e) {
            equipmentTypeQR = null;
          }
        }
      } catch (parseError) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: "Kan hoofdobject niet als JSON lezen.",
            raw: rawString,
          }),
        };
      }
    }

    // Optioneel: message voor frontend als er geen jobs en geen QR zijn
    let message = '';
    if (!equipmentTypeQR && (!jobs || jobs.length === 0)) {
      message = "Er zijn momenteel geen openstaande meldingen.";
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        Jobs: jobs,
        EquipmentTypeQR: equipmentTypeQR,
        hasJobs: jobs && jobs.length > 0,
        message,
      }),
    };

  } catch (err) {
    console.error('Jobs Lambda Error:', err, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
