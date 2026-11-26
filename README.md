# Fokus

Aufgaben- und Auftragssteuerung für Bösner Media. Die App zeigt immer nur den nächsten Schritt, nie die ganze Liste.

- **Jetzt:** eine Aufgabe, ein erster Schritt, ein Knopf „Los“ (15-Minuten-Timer)
- **Eingang:** Vorschläge aus Mails, Frame.io und MeisterTask als Karten, übernehmen oder verwerfen
- **Aufträge:** jeder Auftrag als Linie von der Anfrage bis zur Zahlung, höchstens vier im Fokus
- Läuft am PC und auf dem Handy (zum Homescreen hinzufügen)

## Technik

- [PocketBase](https://pocketbase.io) v0.40 (Datenbank, Login, API) in einem Container
- Oberfläche: `pb_public/` (ohne Framework, Schrift Montserrat selbst gehostet)
- Datenstruktur: `pb_migrations/`
- Einrichtung und Startdaten-Import: `pb_hooks/main.pb.js` + `seed/seed.json`
- Hosting: Bunny Magic Containers, Daten im Volume unter `/pb/pb_data`
- Auslieferung: jeder Push auf `main` baut ein Image (GitHub Container Registry) und rollt es bei Bunny aus

## Umgebungsvariablen (bei Bunny im Container setzen)

| Name | Inhalt |
| --- | --- |
| `FOKUS_EMAIL` | Login-E-Mail (gilt auch für die Admin-Oberfläche unter `/_/`) |
| `FOKUS_PASSWORD` | Passwort, mindestens 10 Zeichen |
| `FOKUS_NAME` | Vorname für die Begrüßung (optional) |

Beim ersten Start legt die App den Nutzer an und importiert innerhalb einer Minute die Startdaten.

## GitHub-Einstellungen für die Auslieferung

- Secret `BUNNYNET_API_KEY`: API-Schlüssel aus dem Bunny-Dashboard (Account → API)
- Variable `APP_ID`: ID der App in Magic Containers

Solange `APP_ID` fehlt, wird nur das Image gebaut.
