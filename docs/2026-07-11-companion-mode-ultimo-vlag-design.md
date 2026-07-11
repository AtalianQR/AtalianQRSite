# Design — Companion-mode via Ultimo-vlag (branch vanaf de vaste portal-URL)

**Datum:** 2026-07-11
**Status:** Ontwerp goedgekeurd. Klaar voor implementatieplan.
**Codebase:** `AtalianQRSite` (Astro.js + Tailwind + Netlify).
**Bouwt voort op:** `docs/2026-07-11-werkplek-companion-qr-design.md` (companion-scherm, IoT/RealPulse, registry §6). Dit document beschrijft **hoe je companion aan/uit zet en instapt** — niet de companion-UI zelf.

---

## 1. Doel

De companion **naast** het bestaande meldingsportaal kunnen uitrollen en ontwikkelen, aan- en uitschakelbaar met **één vinkje in Ultimo**, zonder de bestaande QR-stickers te herdrukken en zonder regressie voor niet-companion locaties. Met de vlag uit gedraagt alles zich exact zoals vandaag; companion kan zo los verder ontwikkeld worden.

**Kernprincipes**
- De **QR-URL per lokaal blijft** `portal.html?id=<SpaceId>&lang=&env=`.
- Een **signaal in Ultimo** (Ja/Nee object feature op de Building, Kenmerk `000152` "Portalcompanion") beslist of companion getoond wordt.
- Melden vanuit companion gebruikt het **traditionele** meldingsportaal en **keert daarna terug** naar companion.
- Alles werkt onder **`?env=test`** zodat we in de Ultimo-testomgeving kunnen testen.

## 2. Het signaal in Ultimo — Building object feature

- **Object feature op de Building** i.p.v. een los veld of een complex-boolean. In Ultimo gedefinieerd als **Kenmerk `000152` "Portalcompanion"**, waardetype **Ja/Nee veld** (boolean), onder *Stamgegevens › Gebouw › Vastgoed › Kenmerken gebouw*.
- **Datamodel:** `Gebouw → ObjectFeatures (OBJECTFEATURE 1:N) → Feature`. Op een concreet gebouw voeg je één `ObjectFeature`-rij toe die naar Feature `000152` verwijst met de Ja/Nee-waarde. Voordeel t.o.v. een dedicated veld: geen schemawijziging, herbruikbaar patroon, en per gebouw beheerbaar zonder overal vinkjes.
- **Granulariteit = building-niveau (bewust).** Een lokaal **zonder** IoT in een enabled gebouw geniet gewoon mee van de companion (weer, nieuws, wifi, vestigingen, naamgever…). Enkel de **live comfort-/drukte-kaarten** blijven weg — die worden per lokaal gestuurd door de IoT-koppeling (`IoTAssetId` in de registry `rooms.json`, ongewijzigd t.o.v. §6 van de bestaande spec). Reden: niet elke klant plaatst overal sensoren.
- **Enkel aan/uit.** Omdat `000152` een Ja/Nee-kenmerk is, draagt het louter de schakelaar. Credentials/IoT-config blijven waar ze zijn (Netlify env-vars, registry) — de object feature brengt géén geheimen in de flow.
- **`GET_SPACE_INFO` breidt uit:** die Ultimo-actie resolvet space → building → `ObjectFeatures` waar `Feature = 000152` en geeft de boolean mee terug (bv. als `companionEnabled`). `space.js` roept `GET_SPACE_INFO` al aan bij het laden van de portal (en geeft al `buildingName` terug, dus de building-context is bereikbaar), dus de vlag komt **zonder extra call** mee. Matchen op de **kenmerkcode `000152`** (stabieler dan de naam "Portalcompanion").
  - **WFL-implementatiedetail (Ultimo):** de object features hangen als **1:N** onder de Building (`Gebouw → ObjectFeatures (OBJECTFEATURE 1:N) → Feature`). De workflow moet die 1:N-relatie **doorlopen/filteren** op `Feature = 000152` en de `Ja/Nee`-waarde van die ene rij uitlezen. Geen rij aanwezig → behandelen als **uit** (`companionEnabled = false`). Dit is de knoop die in de WFL uitgedokterd moet worden.
- De feature-waarde kan in de **test-omgeving** van Ultimo apart gezet worden, zodat companion daar getest wordt zonder productie te raken.

## 3. Instap & branching (QR-URL blijft `portal.html?id=X`)

```
QR-scan → portal.html?id=<SpaceId>&lang=&env=
            │  bij load: space.js → GET_SPACE_INFO → { …, companionEnabled }
            ├─ vlag UIT                     → traditionele meldingsportal (0 regressie)
            ├─ vlag AAN + melden=1 aanwezig → traditionele meldingsportal (round-trip, zie §4)
            └─ vlag AAN + géén melden=1
                 → location.replace('companion.html?id=<SpaceId>&lang=&env=&src=<deze portal-url>')
```

- De branch gebeurt **meteen na de `space.js`-respons**, vóór de melding-UI wordt opgebouwd. Een neutraal laadscherm dekt de hop.
- **`location.replace`** (niet `href`): de portal→companion-hop komt niet in de browser-history, zodat "terug" in de browser geen lus veroorzaakt.
- **`env` wordt doorgegeven** in de redirect-URL, zodat companion en zijn datacalls in dezelfde omgeving blijven (`test`/`prod`).
- `companion.html` = **eigen bestand** (zoals de bestaande 58KB mockup), meertalig NL/FR/EN, Atalian-huisstijl. De aparte Astro-route `/lokaal/[id]` uit de oude spec vervalt: de vaste `portal.html`-entry maakt ze overbodig.

## 4. Melden-round-trip (analoog aan `dm-assistent` → `vendor.html`)

Het round-trip mechanisme bestaat **al** in deze codebase en wordt hergebruikt:

```
companion "Meld een probleem"
   → portal.html?id=<SpaceId>&lang=&env=&src=<companion-url>&melden=1     (normale href → browser-back werkt)
portal.html ziet melden=1  → NIET terug-redirecten naar companion; traditionele meldingsflow draaien
   → na afloop toont portal al de knop "🏢 Terug" → window.location.href = sourceUrl (= companion)
```

**Bestaande bouwstenen die hergebruikt worden:**
- `dm-assistent.html` `buildJobUrl`/`openJob`: hangt `src=location.href` aan de doel-URL en bewaart terugkeer-context in `sessionStorage` vóór het navigeren. (referentiepatroon)
- `portal.html` leest `src` al in als `sourceUrl` (veilig same-origin, regel 468-480) en biedt na afloop **"🏢 Terug naar keuzescherm"** → `window.location.href = sourceUrl` (regel 1020-1046). Enkel de knoptekst mag contextueel worden (bv. "Terug naar overzicht").

**Lus-preventie = de expliciete `melden=1`-marker.** Zelfs in een enabled complex blijft de portal traditioneel zolang `melden=1` aanwezig is. Zonder marker + vlag aan → companion. Robuust en leesbaar; hangt niet af van louter de aanwezigheid van `src`.

**Randgeval:** `portal.html?id=X&melden=1` zonder `src` (bv. een bookmark) → traditionele portal zonder terug-knop, d.w.z. gedrag als vandaag. Aanvaardbaar.

## 5. `?env=test` — testomgeving

Elke schakel draagt `env` door zodat de volledige keten in de testomgeving werkt:
- `portal.html`: leest `env` uit de query (bestaand), gebruikt het voor `space.js` (`GET_SPACE_INFO` → test-Ultimo) en zet het in de companion-redirect-URL.
- `companion.html`: neemt `env` over en geeft het door aan zijn datacalls (`room.js`/RealPulse-proxy, nieuws-feed, enz.).
- Melden-link: `…&env=<env>&melden=1` zodat de melding in dezelfde omgeving landt.
- `CompanionEnabled` wordt in **test-Ultimo** gezet om companion daar te activeren zonder productie te raken.

## 6. Overzicht — wat verandert, wat niet

| Component | Wijziging |
|---|---|
| **Ultimo** | Building object feature — Kenmerk `000152` "Portalcompanion" (Ja/Nee); `GET_SPACE_INFO` resolvet space → building → `ObjectFeatures[Feature=000152]` en geeft `companionEnabled` mee |
| **`space.js`** | `companionEnabled` opnemen in de gesaneerde JSON die de portal krijgt |
| **`portal.html`** | vroege branch na `space.js`: vlag AAN + geen `melden=1` → `location.replace` naar `companion.html` (met `id/lang/env/src`); `melden=1` of vlag UIT → ongewijzigd gedrag |
| **`companion.html`** | **nieuw** bestand: companion-UI + melden-knop die met `src`+`melden=1`+`env` naar `portal.html` gaat |
| **`room.js`** (of gelijk) | server-side RealPulse-proxy voor sensordata, `env`-bewust (zie bestaande spec §14) |
| **Niet-enabled complexen** | **niets** verandert — nul regressie |

## 7. Non-goals / afbakening

- Geen herbouw van de meldingsflow (portal.html blijft dé melder).
- Geen wijziging aan bestaande QR-stickers/URL's.
- Geen per-lokaal companion-boolean; granulariteit blijft op building-niveau via object feature `000152` (IoT-koppeling stuurt enkel de sensorkaarten).
- De companion-UI zelf (widgets, layout, IoT-communicatie) staat in de bestaande spec `2026-07-11-werkplek-companion-qr-design.md`; dit document raakt enkel signaal + instap + round-trip + env.

## 8. Succescriterium

Met `CompanionEnabled` aan (in test) toont het scannen van `portal.html?id=<SpaceId>&env=test` de companion; "Meld een probleem" opent het traditionele portaal, en na de melding keert de gebruiker terug in de companion. Met de vlag uit gedraagt exact dezelfde URL zich als het huidige meldingsportaal — zonder enige regressie.

## 9. Referenties

- Companion-UI & IoT: `docs/2026-07-11-werkplek-companion-qr-design.md`
- Instap/branch: `src/pages/portal.html` (`sourceUrl` regel 468-480; "terug"-knop regel 1020-1046; `space.js`-call regel 592)
- Round-trip-patroon: `src/pages/dm-assistent.html` (`buildJobUrl`/`openJob` regel 421-445)
- Ultimo-call: `netlify/functions/space.js` (`GET_SPACE_INFO`), `netlify/functions/complexinfo.js` (complex-acties)
