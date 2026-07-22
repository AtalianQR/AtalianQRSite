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

## Wie bericht krijgt bij een nieuwe melding

*Nog niet actief.*

> **Elk complex heeft minstens een aangevinkte contactpersoon nodig.** Is er niemand aangevinkt, dan kan het gebeuren dat er over een melding **helemaal geen bericht** naar de klant vertrekt — zonder foutmelding, zonder dat iemand het merkt. Zie *Waarom dit belangrijk is* hieronder.

### Iemand aanvinken

Contactpersonen worden aan een gebouw of complex gekoppeld. Op die koppeling staat een vinkje: **krijgt bericht bij een nieuwe melding**.

Vink het aan bij iedereen die op de hoogte moet zijn van nieuwe tickets voor dat gebouw. Meestal is dat de facility manager bij de klant, soms ook zijn plaatsvervanger of een tweede verantwoordelijke.

Je hoeft geen e-mailadres in te vullen: dat haalt het systeem uit de fiche van die persoon. Wijzigt het adres later, dan pas je het één keer aan op de fiche en volgen alle gebouwen mee.

Staat iemand er niet bij in de lijst, dan is hij nog niet aan dit gebouw gekoppeld. Leg die koppeling eerst.

### Meerdere mensen aanvinken mag

Anders dan bij een enkel veld kun je hier **zoveel personen aanvinken als nodig**. Iedereen die aangevinkt staat, krijgt bericht.

Staat dezelfde persoon zowel op het gebouw als op het complex aangevinkt, dan krijgt hij toch maar één mail — het systeem ontdubbelt.

### Wat er gebeurt

De adressen van alle aangevinkte contactpersonen worden bij elke melding de ontvangers.

| Situatie | Resultaat |
|---|---|
| de melder gaf geen adres op | alleen de aangevinkte contactpersonen |
| de melder gaf een adres op en wil bericht | de aangevinkte contactpersonen plus de melder |
| de melder wil géén bericht | alleen de aangevinkte contactpersonen |
| de melder staat zelf aangevinkt | zijn adres een keer, niet dubbel |
| **er is niemand aangevinkt** | **mogelijk vertrekt er geen enkele mail** |
| een aangevinkte persoon heeft geen e-mailadres | die wordt overgeslagen — vul zijn fiche aan |

### Waarom dit belangrijk is

De vijfde regel in de tabel is de reden om dit overal in orde te brengen. Wie via een QR-code meldt, is niet verplicht een e-mailadres achter te laten, en mag ook aangeven geen bericht te willen. Gebeurt dat en staat er niemand aangevinkt, dan is er **niemand** om de klantmail naartoe te sturen. De melding komt wel binnen en wordt gewoon behandeld — maar aan klantzijde blijft het stil, en niemand volgt op.

Er verschijnt geen waarschuwing wanneer dat gebeurt. Het valt alleen op wanneer een klant belt met de vraag waarom hij nooit iets hoort.

### Op gebouw of op complex

Beide kan. Geldt iemand voor een hele site, vink hem dan aan op het complex. Heeft een afzonderlijk gebouw een eigen beheerder, vink die dan aan op dat gebouw.

De twee sluiten elkaar niet uit: bij een melding krijgen **zowel** de mensen van het gebouw **als** die van het complex bericht. Iemand die op complexniveau staat, wordt dus niet overgeslagen omdat er toevallig ook iemand op gebouwniveau aangevinkt is.

### Een adres per melding toevoegen

In een melding zelf kun je het veld `_ContactMail` aanvullen met extra adressen, of er een weghalen. Wat je daar wijzigt, blijft zo — het systeem zet niets terug.

Ultimo controleert bij het opslaan wel of elk adres een `@` bevat, en blokkeert met een waarschuwing als dat niet klopt.

---

## Waarom een klant geen mail kreeg

Loop deze punten na in deze volgorde.

**Staat er een adres in `_ContactMail`?** Is dat veld leeg, dan vertrekt er geen klantmail. Kijk dan of er wel iemand aangevinkt staat om bericht te krijgen op dat gebouw of complex. Dit is veruit de meest voorkomende oorzaak.

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
