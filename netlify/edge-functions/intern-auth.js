// netlify/edge-functions/intern-auth.js
//
// Schermt de interne handleiding af met een sleutel in de URL.
//
//   Ultimo opent  /handleiding/intern-b361731347/?key=<sleutel>
//   via _OpenWebPage.wfl, commando "Manual", tak Context 0 (eigen medewerker).
//
// De sleutel staat op twee plaatsen en moet daar gelijk zijn:
//   - hier, als env var ULTIMO_MANUAL_INTERN
//   - in _OpenWebPage.wfl, in de URL van de interne handleiding
// Wissel je hem, wissel dan beide - anders komt niemand er nog in.
//
// Wat dit wel doet: voorkomen dat wie het adres toevallig kent, kan meelezen.
// Wat dit niet doet: controleren WIE je bent. Netlify kan niet nagaan of je een
// geldige Ultimo-gebruiker bent; het weet enkel dat je de sleutel hebt. Wie de
// volledige link doorstuurt, geeft de toegang mee.

const KEY_PARAM = "key";

function geweigerd() {
  return new Response(
    "Deze pagina is enkel bereikbaar via Ultimo.\n" +
      "Open de handleiding vanuit Ultimo in plaats van via een bewaarde link.",
    {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

// Vergelijking in constante tijd: een gewone === lekt via het tijdsverschil
// waar het eerste afwijkende teken zit, waardoor de sleutel teken per teken
// te raden valt.
function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export default async (request, context) => {
  const expected = Netlify.env.get("ULTIMO_MANUAL_INTERN");

  // Geen sleutel ingesteld: dichthouden. Open doorlaten zou de pagina
  // stilzwijgend publiek maken, precies wat deze functie moet voorkomen.
  if (!expected) {
    return new Response(
      "Interne handleiding is niet beschikbaar: ULTIMO_MANUAL_INTERN ontbreekt.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const aangeboden = new URL(request.url).searchParams.get(KEY_PARAM);
  if (!aangeboden || !safeEqual(aangeboden, expected)) return geweigerd();

  const response = await context.next();
  const out = new Response(response.body, response);
  out.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  out.headers.set("cache-control", "no-store");
  return out;
};

// Alle drie de vormen expliciet: zonder streep, met streep, en alles eronder.
// Wordt er een vorm niet gematcht, dan is de pagina langs die weg gewoon
// onbeschermd bereikbaar - een fout die je niet ziet tenzij je hem test.
export const config = {
  path: [
    "/handleiding/intern-b361731347",
    "/handleiding/intern-b361731347/",
    "/handleiding/intern-b361731347/*",
  ],
};
