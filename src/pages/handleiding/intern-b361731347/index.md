---
layout: ../../../layouts/ManualLayoutIntern.astro
title: Interne handleiding – Ultimo configuratie
---

## Over deze handleiding

Deze handleiding is bedoeld voor **Atalian-medewerkers** die Ultimo beheren, niet voor klanten. Ze beschrijft hoe de instellingen achter het QR-klantenportaal werken: welke kenmerken je waar invult, wat er gebeurt als je ze leeg laat, en waarom bepaalde mails wel of niet vertrekken.

Open deze pagina altijd **vanuit Ultimo**. De link bevat een sleutel; zonder die sleutel krijg je de pagina niet te zien. Stuur de volledige link daarom niet door — wie hem heeft, kan meelezen, ook buiten Atalian. Zoekmachines nemen de pagina niet op.

> **Let op bij het lezen.** Onderdelen die gemarkeerd zijn met *nog niet actief* zijn ontworpen maar nog niet in productie. Ze staan hier zodat de handleiding meegroeit met de bouw, maar je kan er vandaag nog niets mee.

---

## Kenmerken op gebouw en complex

Verschillende instellingen hangen als **kenmerk** aan een gebouw of aan een complex. Je vindt ze via *Vastgoed → Gebouwen → tabblad Kenmerken*.

Elk kenmerk heeft afhankelijk van zijn soort een **Ja/Nee waarde**, een **Numerieke waarde** of een **Alfanumerieke waarde**. Vul altijd de kolom in die bij dat kenmerk hoort; een waarde in de verkeerde kolom wordt niet gelezen en levert geen foutmelding op.

### Opzoekvolgorde

Voor de meeste kenmerken geldt dezelfde regel:

1. eerst wordt gekeken op het **gebouw** van de melding
2. staat daar niets, dan op het **complex**

Elke job hangt altijd aan een complex, maar niet altijd aan een gebouw. Het complex is dus de betrouwbare basis, en het gebouw de verfijning voor wie het fijnmaziger wil regelen. Wil je één instelling voor een hele site, zet ze dan op het complex en laat de gebouwen leeg.

### Bestaande kenmerken

| Kenmerk | Soort | Waarvoor |
|---|---|---|
| QR-Portalcompanion | Ja/Nee | schakelt de companion-functie in het portaal in |
| Wifi Intern IP | Alfanumeriek | IP-bereik van het interne netwerk |
| Wifi Guest IP | Alfanumeriek | IP-bereik van het gastnetwerk |
| Wifi Guest SSID | Alfanumeriek | naam van het gastnetwerk |
| Wifi Guest Password | Alfanumeriek | wachtwoord van het gastnetwerk |
| SoundsensingID | Alfanumeriek | koppeling met een Soundsensing-sensor |

---

## Taal van de klantmail

*Nog niet actief.*

Vandaag krijgt de klant zijn mail in de taal waarin **de Atalian-medewerker is ingelogd**. Iemand die in het Frans werkt, stuurt Franse mail naar een Nederlandstalige klant. Dat is willekeurig en niet uit te leggen aan de klant.

### De taal instellen

Zet op het gebouw of het complex het kenmerk **DefaultLanguage**, in de kolom *Alfanumerieke waarde*.

| Waarde | Gevolg |
|---|---|
| `NL` | de klant krijgt enkel Nederlandse tekst |
| `FR` | de klant krijgt enkel Franse tekst |
| leeg | de klant krijgt beide talen onder elkaar |

### Waarop letten bij de taal

De taal geldt **per gebouw**, niet per persoon. Alle ontvangers van dezelfde melding krijgen dus dezelfde taal. Dat is bewust: een mail vertrekt in één keer naar alle geadresseerden en kan maar één taal dragen.

Laat het kenmerk gerust leeg als je twijfelt. De tweetalige versie is voor niemand fout — enkel wat langer. Vul je een taal in waarvan je niet zeker bent, dan krijgt de klant mail in een taal die hij mogelijk niet leest, en dat merk je pas als hij klaagt.

Voor sites waar beide talen door elkaar lopen, is leeg laten de juiste keuze en geen tijdelijke oplossing.

---

## Vast e-mailadres per gebouw

*Nog niet actief.*

### Het adres instellen

Zet op het gebouw of het complex het kenmerk **DefaultMail**, in de kolom *Alfanumerieke waarde*: het adres van de persoon die meldingen over dat gebouw altijd moet zien, meestal de facility manager van de klant.

### Wat er gebeurt

Dit adres wordt bij elke melding toegevoegd aan de ontvangers.

| Situatie | Resultaat |
|---|---|
| de melder gaf geen adres op | het vaste adres is de enige ontvanger |
| de melder gaf wel een adres op | beide adressen ontvangen de mail |
| het vaste adres is ook dat van de melder | één mail, geen dubbele |
| er is geen kenmerk ingevuld | enkel wat de melder opgaf |

Eén invulling dekt dus twee behoeften: ze vangt op wanneer niemand een adres achterliet, én ze zorgt dat de gebouwbeheerder meeleest wanneer er wél een adres is.

### Meerdere adressen

Je kan in het veld `_ContactMail` van een melding zelf meerdere adressen zetten, gescheiden door een komma of een puntkomma. Ultimo controleert bij het opslaan of elk adres een `@` bevat en blokkeert de melding met een waarschuwing als dat niet klopt.

---

## Waarom een klant geen mail kreeg

Loop deze punten na in deze volgorde.

**Staat er een adres in `_ContactMail`?** Is dat veld leeg en is er geen `DefaultMail` op het gebouw of complex, dan vertrekt er geen klantmail. Dit is veruit de meest voorkomende oorzaak.

**Is de melding via de juiste statusovergang gegaan?** Sommige notificaties hangen aan één specifieke progressstatus. Wordt een job langs een andere weg afgewerkt, dan wordt die stap overgeslagen en vertrekt de mail niet — zonder foutmelding.

**Heeft het complex een vakgroep met een mailadres?** De melding aan de vakgroep bij status *volledig uitgevoerd* vertrekt enkel wanneer het complex een vakgroep heeft **en** die vakgroep een mailadres. Ontbreekt een van beide, dan gebeurt er niets en wordt er niets gelogd.

**Gaat het om een interne job?** Werkordertype `009` wordt bewust overgeslagen bij die melding.

**Waren er nog openstaande uren?** Wie een job afsluit terwijl er nog niet-verwerkte uren op staan, wordt geblokkeerd. De hele afhandeling stopt dan, inclusief de mails die erna zouden komen.

---

## Welke handleiding krijgt wie

De knop **Handleiding** in Ultimo opent niet voor iedereen dezelfde pagina. De workflow `_OpenWebPage` kijkt naar de aangemelde gebruiker en beslist:

| Wie | Krijgt |
|---|---|
| Atalian-medewerker | deze interne handleiding |
| contactpersoon van Covestro | de Covestro-handleiding |
| andere contactpersoon, Franstalig | de algemene handleiding in het Frans |
| andere contactpersoon | de algemene handleiding in het Nederlands |

Het onderscheid tussen medewerker en klant gebeurt op het veld **Context** van de employee: `1` is een Atalian-medewerker, `4` een klantcontactpersoon. Het departement wordt daarvoor **niet** gebruikt — ook medewerkers kunnen aan een departement hangen, dus dat zou een deel van het personeel ten onrechte uitsluiten.

Krijgt iemand de verkeerde handleiding, kijk dan op zijn employee-record naar het veld **Context** en het gekoppelde departement. Die twee bepalen samen welke tak gekozen wordt.

Een nieuwe klantspecifieke handleiding toevoegen komt neer op één extra tak in die workflow, met de klantcode als voorwaarde.

---

## Nog te documenteren

Deze onderdelen horen in deze handleiding thuis maar zijn nog niet uitgewerkt:

- welke notificaties buiten de workflows om ingesteld staan, en op welke progressstatussen
- het opvolgen van een melding door de melder zelf, en hoe die keuze wordt vastgelegd
- het privacyakkoord in het portaal en wanneer het opnieuw gevraagd wordt
- welke sjabloon bij welke gebeurtenis gebruikt wordt
