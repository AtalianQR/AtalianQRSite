# Design — Companion-mode via Ultimo-vlag (branch vanaf de vaste portal-URL)

**Datum:** 2026-07-11
**Status:** Ontwerp goedgekeurd. Gefaseerde bouw; **eerste stap = de Query-WFL die kenmerk `000151` voor de ruimte ophaalt** (zie §7, Fase 0).
**Codebase:** `AtalianQRSite` (Astro.js + Tailwind + Netlify).
**Bouwt voort op:** `docs/2026-07-11-werkplek-companion-qr-design.md` (companion-scherm, IoT/RealPulse, registry §6). Dit document beschrijft **hoe je companion aan/uit zet en instapt** — niet de companion-UI zelf.

---

## 1. Doel

De companion **naast** het bestaande meldingsportaal kunnen uitrollen en ontwikkelen, aan- en uitschakelbaar met **één vinkje in Ultimo**, zonder de bestaande QR-stickers te herdrukken en zonder regressie voor niet-companion locaties. Met de vlag uit gedraagt alles zich exact zoals vandaag; companion kan zo los verder ontwikkeld worden.

**Kernprincipes**
- De **QR-URL per lokaal blijft** `portal.html?code=<QR>&lang=&env=`. De `code` is de QR-payload (8–20 cijfers); `parseUltimoQR` (`public/js/CodeUrl.js`) leidt de **SpaceId** af uit de even posities, laatste cijfer = indicator (`9`=installatie, anders ruimte). Companion draagt diezelfde `code` mee (en kan in dev een kale `id` ⇄ `code` converteren).
- Twee **Ultimo object features** sturen alles: `000151` "Iot Factory asset ID" (Space → welk device) en `000152` "Portalcompanion" (Building → aan/uit). Zie §2.
- Melden vanuit companion gebruikt het **traditionele** meldingsportaal en **keert daarna terug** naar companion.
- Alles werkt onder **`?env=test`** zodat we in de Ultimo-testomgeving kunnen testen.

## 2. De twee Ultimo object features (de ankers)

Alles hangt aan **object features** (objectkenmerken), niet aan dedicated velden. Twee kenmerken sturen de flow:

| Code | Kenmerk | Hangt aan | Waardetype | Rol |
|---|---|---|---|---|
| **000151** | Iot Factory asset ID | **Ruimte** (Space) | Alfanumeriek | RealPulse-asset-id → *welk device* companion moet uitlezen |
| **000152** | Portalcompanion | **Gebouw** (Building) | Ja/Nee | companion *aan/uit* voor het hele gebouw |

Beide hangen als **1:N** onder hun object: `<Object> → ObjectFeatures (OBJECTFEATURE 1:N) → Feature`. Op een concreet object voeg je één `ObjectFeature`-rij toe die naar de betreffende Feature verwijst met de waarde. Voordeel t.o.v. een dedicated veld: geen schemawijziging, herbruikbaar patroon, per object beheerbaar zonder overal vinkjes.

**Ultimo = master, de `*.js` = slaves (routing op description).** De proxy hardcodeert géén kenmerkcode. De WFL geeft de kenmerken van het object terug (`code + description + value`), en de `*.js` **routeert op de feature-description** naar het juiste bronsysteem: description bevat "iot" → RealPulse (waarde = asset-id); bij installaties bevat ze "soundsensing" → Soundsensing (waarde = device-id). Een nieuwe integratie toevoegen = een kenmerk met de juiste naam in Ultimo, zonder codewijziging downstream. Zo bepaalt Ultimo (de naamgeving) welk systeem geldt.

Bevestigde Ultimo-metadata (entity `ObjectFeature`): `AlphanumericValue` (kolom `OBJFALPHANUMERIC`, string 250) = de waarde; relaties `Space` (`OBJFSPCID`), `Building` (`OBJFBLDID`), `Equipment`, `Feature` (`OBJFFTRID`). `Feature.Id` = de code (bv. `000151`), `Feature.Description` = de naam.

### 2.1 Kenmerk `000151` "Iot Factory asset ID" (Space, alfanumeriek)
- Draagt per lokaal de **RealPulse-asset-id** (bv. Ruimte 001406 "Brel" → `6508159013019d0012630847`). Dit vervangt de `iotAssetId` in de registry `rooms.json` uit §6 van de bestaande spec: de koppeling leeft nu in Ultimo op de Space.
- Een lokaal **zonder** deze feature heeft geen IoT-koppeling → companion toont er de live comfort-/drukte-kaarten niet, de rest wél.
- **Server-side gebruikt** (zie §4, keuze A): `room.js` haalt via de WFL de kenmerken op, kiest het kenmerk met een IoT-description en gebruikt zijn `AlphanumericValue` als RealPulse-asset-id. De asset-id gaat **niet** naar de browser.

### 2.2 Kenmerk `000152` "Portalcompanion" (Building, Ja/Nee)
- Eén Ja/Nee-kenmerk op het gebouw zet companion aan/uit voor de hele site. **Granulariteit = building-niveau (bewust):** een lokaal zonder IoT in een enabled gebouw geniet gewoon mee van de companion (weer, nieuws, wifi, vestigingen, naamgever…); enkel de sensorkaarten hangen af van `000151`. Reden: niet elke klant plaatst overal sensoren.
- **Enkel aan/uit** — géén geheimen. Credentials blijven server-side (§4).
- `GET_SPACE_INFO` resolvet space → building → `ObjectFeatures[Feature=000152]` en geeft de boolean mee (bv. `companionEnabled`). `space.js` roept `GET_SPACE_INFO` al aan bij load (geeft al `buildingName` terug), dus de vlag komt **zonder extra call** mee. **Geen rij aanwezig → behandelen als uit** (`companionEnabled = false`).
- De feature-waarde kan in de **test-omgeving** van Ultimo apart gezet worden, zodat companion daar getest wordt zonder productie te raken.

## 3. Instap & branching (QR-URL blijft `portal.html?code=<QR>`)

```
QR-scan → portal.html?code=<QR>&lang=&env=
            │  bij load: space.js → GET_SPACE_INFO → { …, companionEnabled }
            ├─ vlag UIT                     → traditionele meldingsportal (0 regressie)
            ├─ vlag AAN + melden=1 aanwezig → traditionele meldingsportal (round-trip, zie §4)
            └─ vlag AAN + géén melden=1
                 → location.replace('companion.html?code=<QR>&lang=&env=&src=<deze portal-url>')
```
Companion leidt de SpaceId uit de `code` af voor `room.js`/`space.js`.

- De branch gebeurt **meteen na de `space.js`-respons**, vóór de melding-UI wordt opgebouwd. Een neutraal laadscherm dekt de hop.
- **`location.replace`** (niet `href`): de portal→companion-hop komt niet in de browser-history, zodat "terug" in de browser geen lus veroorzaakt.
- **`env` wordt doorgegeven** in de redirect-URL, zodat companion en zijn datacalls in dezelfde omgeving blijven (`test`/`prod`).
- `companion.html` = **eigen bestand** (zoals de bestaande 58KB mockup), meertalig NL/FR/EN, Atalian-huisstijl. De aparte Astro-route `/lokaal/[id]` uit de oude spec vervalt: de vaste `portal.html`-entry maakt ze overbodig.

## 4. Sensordata-resolutie (keuze A) & credentials

**Keuze A — `room.js` resolvet zelf.** De browser stuurt enkel `spaceId` (+`lang`,`env`); alle Ultimo- en RealPulse-logica zit in de functie. Companion blijft "dom".

```
companion.html  →  room.js?spaceId=<SpaceId>&lang=&env=
   room.js:
     1) Ultimo WFL GET_SPACE_FEATURES → { features:[{code,description,value}] }
     2) routeer op description: bevat "iot" → RealPulse; value = asset-id
     3) RealPulse: GET /api/assets/<asset-id>  (Basic Auth, creds server-side)
     4) terug: gesaneerd { coupled, temp, co2, hum, motion, updatedAt }
                (GEEN asset-id, GEEN creds naar de browser; ?debug=1 echo't ze wel)
   geen IoT-kenmerk → { coupled: false }  → companion laat de sensorkaarten weg
```

Waarom A boven "portal geeft de id mee in de URL": nette URL's, de browser kent de asset-id niet, en de resolutie + routing zitten op één plek. Kost een extra Ultimo-call in de functie — aanvaardbaar (server-side, cachebaar).

**Credentials in Netlify (niet in Ultimo).** De RealPulse-creds blijven **Netlify env-vars**, uitsluitend server-side gelezen door `room.js` (precedent: `soundsensing-sync.js`).
- **Demo = één omgeving, één sleutelpaar** (`REALPULSE_USER` / `REALPULSE_PASS`). Voldoende voor nu.
- **Later, per gebouw/klant:** conventie-genaamde vars op de `buildingId` die we tóch al resolven — `REALPULSE_USER__<buildingId>` / `REALPULSE_PASS__<buildingId>`, met de kale variant als fallback. Netlify heeft géén per-tenant scoping; de keuze gebeurt in de functie.
- **Grens om te kennen:** Netlify-functies draaien op AWS Lambda → **~4 KB voor álle env-vars samen**. Bij veel klanten die limiet mijden door de credential-map naar **Netlify Blobs**/secret manager te verhuizen. Voor de demo niet relevant.

## 5. Melden-round-trip (analoog aan `dm-assistent` → `vendor.html`)

Het round-trip mechanisme bestaat **al** in deze codebase en wordt hergebruikt:

```
companion "Meld een probleem"
   → portal.html?code=<QR>&lang=&env=&src=<companion-url>&melden=1     (normale href → browser-back werkt)
portal.html ziet melden=1  → NIET terug-redirecten naar companion; traditionele meldingsflow draaien
   → na afloop toont portal al de knop "🏢 Terug" → window.location.href = sourceUrl (= companion)
```

**Bestaande bouwstenen die hergebruikt worden:**
- `dm-assistent.html` `buildJobUrl`/`openJob`: hangt `src=location.href` aan de doel-URL en bewaart terugkeer-context in `sessionStorage` vóór het navigeren. (referentiepatroon)
- `portal.html` leest `src` al in als `sourceUrl` (veilig same-origin, regel 468-480) en biedt na afloop **"🏢 Terug naar keuzescherm"** → `window.location.href = sourceUrl` (regel 1020-1046). Enkel de knoptekst mag contextueel worden (bv. "Terug naar overzicht").

**Lus-preventie = de expliciete `melden=1`-marker.** Zelfs in een enabled complex blijft de portal traditioneel zolang `melden=1` aanwezig is. Zonder marker + vlag aan → companion. Robuust en leesbaar; hangt niet af van louter de aanwezigheid van `src`.

**Randgeval:** `portal.html?code=<QR>&melden=1` zonder `src` (bv. een bookmark) → traditionele portal zonder terug-knop, d.w.z. gedrag als vandaag. Aanvaardbaar.

## 6. `?env=test` — testomgeving

Elke schakel draagt `env` door zodat de volledige keten in de testomgeving werkt:
- `portal.html`: leest `env` uit de query (bestaand), gebruikt het voor `space.js` (`GET_SPACE_INFO` → test-Ultimo) en zet het in de companion-redirect-URL.
- `companion.html`: neemt `env` over en geeft het door aan zijn datacalls (`room.js`/RealPulse-proxy, nieuws-feed, enz.).
- Melden-link: `…&env=<env>&melden=1` zodat de melding in dezelfde omgeving landt.
- `CompanionEnabled` wordt in **test-Ultimo** gezet om companion daar te activeren zonder productie te raken.

## 7. Implementatievolgorde (fasering) — start met de Query-WFL

Niet alles tegelijk: bouw de **dunste verticale plak** die de héle keten bewijst (*Ultimo-feature → asset-id → RealPulse → scherm*), en laat de rest decoratie zijn.

- **Fase 0 · Ultimo/WFL — de eerste stap. ✅ gebouwd.** Action **`GET_SPACE_FEATURES`** in `_rest_QueryAtalianJobs.wfl`: voor een `SpaceId` de **Space-`ObjectFeatures` 1:N** (`Query Type="ObjectFeature"`, filter `Space=${SpaceId}`, join `Feature` alias FTR) → `{features:[{code,description,value}]}` (value = `AlphanumericValue`), leeg = `'{}'`. Géén codefilter — Ultimo blijft master, `room.js` routeert op description. (De building-`000152`-vlag komt pas in Fase 3.)
- **Fase 1 · dunne plak, op `localhost` (`netlify dev`).**
  1. **`room.js`** — keuze A ✅: `?spaceId=&lang=&env=` → `GET_SPACE_FEATURES` → routeer op description ("iot" → RealPulse) → RealPulse server-side → gesaneerde `{coupled, temp, co2, hum, motion, updatedAt}`. `?debug=1` echo't de kenmerken + match.
  2. **`companion.html`** — minimale pagina die één **comfortkaart** voor Brel toont + "Meld een probleem" (`src`+`melden=1`).
  3. **`portal.html`** — **dev-bypass**: op `localhost` (of `?companion=1`) meteen naar companion redirecten, **zónder** de `000152`-vlagtest, zodat de keten rijdt vóór de vlag-WFL af is.
- **Fase 2 · widgets.** Weer, nieuws, vestigingen, wifi, naamgever — puur UI bovenop de werkende pipeline.
- **Fase 3 · productie-poort.** De `000152`-vlag in de WFL + de échte branch in `portal.html` (aan → companion, uit → traditioneel); dev-bypass erachter/eruit.

## 8. Overzicht — wat verandert, wat niet

| Component | Wijziging |
|---|---|
| **Ultimo — Query-WFL (Fase 0) ✅** | action `GET_SPACE_FEATURES`: voor `SpaceId` de Space-`ObjectFeatures` teruggeven als `{features:[{code,description,value}]}`. Later ook building-`ObjectFeatures[Feature=000152]` → `companionEnabled` |
| **`room.js` ✅** | keuze A: `?spaceId=&env=` → `GET_SPACE_FEATURES` → routeer op description → RealPulse server-side → gesaneerde sensordata; `env`-bewust; creds uit Netlify env-vars |
| **`companion.html`** | **nieuw** bestand: companion-UI; sensorkaart via `room.js?spaceId=`; melden-knop met `src`+`melden=1`+`env` naar `portal.html` |
| **`portal.html`** | Fase 1: dev-bypass (`localhost`/`?companion=1`) → companion. Fase 3: branch na `space.js` op `companionEnabled`, met `melden=1`/vlag-uit → ongewijzigd gedrag |
| **`space.js`** | Fase 3: `companionEnabled` (building-`000152`) opnemen in de gesaneerde JSON |
| **Niet-enabled gebouwen** | **niets** verandert — nul regressie |

## 9. Content-laag (laag 3) — kenmerken + documenten (Ultimo master, FM-beheerd)

De niet-sensor content (naamgever, capaciteit, hasWindow, wifi, vestigingen…) leeft **in Ultimo** zodat elke FM het per klant instelt. Twee dragers, elk voor waar ze sterk in zijn:

**① Kenmerken (object features)** — scalairs/vlaggen, querybaar, FM zet ze op de Kenmerken-tab (zelfde patroon als `000151/000152`), komen mee via `GET_SPACE_FEATURES`:
- `Companion capaciteit` (Numeriek) — of Ultimo's native Space-capaciteit als die bestaat
- `Companion raam` (Ja/Nee) = hasWindow ("verlucht via raam" vs "meld voor bijregeling")
- `Companion ruimtetype` (Meerkeuze) — of native ruimtesoort

**② Documenten** — meertalige/rijke + gedeelde content, met overerving **ruimte ← gebouw ← complex** (ruimte overschrijft gebouw overschrijft complex).

**Eén documentsoort voor het hele portaal** (bv. `Companion content`), en elk document **beschrijft zichzelf** via een veld `doel` bovenaan. Zo hangt onder één soort elk soort portaaldocument (naamgever, wifi, vestigingen…), en `content.js` routeert op `doel` — exact parallel met de feature-routing op description (§4). De WFL matcht op de **documentsoort-code** (stabiel), niet op de bestandsnaam. Zo blijft het beheersbaar met veel documenten.

Ruimte-niveau (`doel: "naamgever"`):
```json
{
  "doel": "naamgever",
  "schema": "companion.v1",
  "naamgever": {
    "naam": "Toots Thielemans",
    "discipline":   { "nl": "Jazzmuzikant · 1922–2016", "fr": "…", "en": "…" },
    "omschrijving": { "nl": "Belgische jazzlegende die de mondharmonica…", "fr": "…", "en": "…" },
    "weetjes": [
      { "nl": "…", "fr": "…", "en": "…" },
      { "nl": "…", "fr": "…", "en": "…" }
    ]
  },
  "bronnen": [ "https://…" ]
}
```
`omschrijving` = de vaste "wie is dit"-regel (toont altijd); `weetjes` = array waaruit de companion **willekeurig** één toont (zodat je niet steeds dezelfde tekst ziet). Geseede documenten + generator staan **buiten de repo** (niet naar GitHub) in `OneDrive\Claude\Atalian-Claude\QRWebportaal\Anderlecht - vergaderzalen\` (`build_meetingroomexplanation_docs.py` → `meetingroomexplanation-<naamgever>.json`, 15 weetjes/persoon NL/FR/EN). Elk wordt in Ultimo als document van soort **35 (QR settings)** op de betreffende Space gehangen; de WFL filtert op die soort-code, niet op de bestandsnaam.
Gebouw-/complex-niveau (gedeeld, één keer invullen):
```json
{
  "wifi": { "ssid": "…", "password": "…" },
  "vestigingen": [ { "naam": "…", "reistijdMin": 12 } ],
  "nieuwsbron": { "nl": "VRT NWS", "fr": "RTBF Info", "en": "The Brussels Times" },
  "lunch": { "nl": "…", "fr": "…", "en": "…" }
}
```

**Leespad:**
- `GET_SPACE_FEATURES` (bestaat) → scalairs + resolve building/complex-id's (uitbreiden zodat het die id's meegeeft).
- nieuwe WFL `GET_OBJECT_DOCS` (object-type + id, filter op **documentsoort-code** `Companion content`) → de bijgevoegde JSON-documenten (base64). Precedent: `_rest_ObjDocSendB64.wfl`, `GET_JOB_DOC` (`jobquery.js`). *(Exacte ObjectDocument-query + soort-code bevestigen bij het bouwen.)*
- nieuwe **`content.js`**: haalt de documenten voor ruimte+gebouw+complex, **routeert op `doel`**, en merge't (ruimte>gebouw>complex) samen met de features tot één content-JSON; `companion.html` rendert die **samen** met de live sensors uit `room.js`. Voor `doel: "naamgever"` toont het de vaste `omschrijving` + een **willekeurig** weetje uit `weetjes`.

**FM-vriendelijkheid:** kenmerken = triviaal; het JSON-document niet. Demo: jij auteur het. Product: een kleine **"Companion content"-editor** (webformulier dat `companion.json` via de Ultimo-API leest/schrijft) zodat een FM nooit ruwe JSON ziet.

**Fasering:** dit is **Fase 2** (content/widgets), ná de `portal.html` dev-bypass. Eerste content-stap: `GET_OBJECT_DOC` + `content.js` + de naamgever-kaart in companion.

## 10. Non-goals / afbakening

- Geen herbouw van de meldingsflow (portal.html blijft dé melder).
- Geen wijziging aan bestaande QR-stickers/URL's.
- Geen per-lokaal companion-boolean; granulariteit blijft op building-niveau via object feature `000152` (de asset-koppeling `000151` stuurt enkel de sensorkaarten).
- De companion-UI zelf (widgets, layout, IoT-communicatie) staat in de bestaande spec `2026-07-11-werkplek-companion-qr-design.md`; dit document raakt enkel signaal + instap + round-trip + env.

## 11. Succescriterium

**Fase 1 (dunne plak, localhost) — ✅ bereikt:** `localhost:8888/companion.html?id=001406&debug=1` toont de companion voor Brel met een **live comfortkaart** (data via `room.js` → routing op description → RealPulse), en "Meld een probleem" → `portal.html?code=<QR>&src=…&melden=1` (companion synthetiseert de `code` uit de id) opent het traditionele portaal en keert via de bestaande "Terug"-knop terug. Dit bewijst de volledige pijplijn.

**Eindbeeld (Fase 3):** met `000152` aan toont het scannen van `portal.html?code=<QR>&env=test` de companion; met de vlag uit gedraagt exact dezelfde URL zich als het huidige meldingsportaal — zonder enige regressie.

## 12. Referenties

- Companion-UI & IoT: `docs/2026-07-11-werkplek-companion-qr-design.md`
- Instap/branch: `src/pages/portal.html` (`sourceUrl` regel 468-480; "terug"-knop regel 1020-1046; `space.js`-call regel 592)
- Round-trip-patroon: `src/pages/dm-assistent.html` (`buildJobUrl`/`openJob` regel 421-445)
- Ultimo-call: `netlify/functions/space.js` (`GET_SPACE_INFO`), `netlify/functions/complexinfo.js` (complex-acties)
- Object features: `000151` "Iot Factory asset ID" (Space, alfanumeriek) · `000152` "Portalcompanion" (Building, Ja/Nee) — beide `Object → ObjectFeatures (1:N) → Feature`
- RealPulse/IoT (endpoints, asset-ids, creds): bestaande spec §14 + cockpit `OneDrive\Claude\Atalian-Claude\Iot Factory\CLAUDE.md`
