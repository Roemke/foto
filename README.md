# Schulfotos

Webanwendung zum Sammeln, Verschlagworten, Bewerten und Wiederfinden von Schulfotos.
Sie ersetzt die bisherige Arbeit mit Adobe Bridge auf einem Netzlaufwerk (Nextcloud).

## Idee

Die Fotos bleiben als normale JPEG-Dateien in einem Ordnerbaum liegen. Alle Metadaten
(Sterne, Schlagwörter, Fotograf, Datum) stehen **in den Dateien selbst** (XMP/EXIF).
Die Datenbank ist nur ein schneller Index darüber. Dadurch bleiben die Fotos auch ohne
die App nutzbar, etwa mit Adobe Bridge, und der Index lässt sich jederzeit neu aufbauen.

## Funktionen

- Fotoübersicht mit Filtern: Zeitraum, Sterne, Tags (nach Gruppen, mit Trefferzahlen)
- Großansicht mit Blättern, Info-Panel, Download des Originals, ZIP-Download mehrerer Fotos
- Upload einzelner JPEGs oder ZIP-Dateien, mit Dublettenerkennung und Einsortierung in
  `Jahr/MM-Monat`, Dateiname `JJJJ-MM-TT-HHhMMmSSs-Anlass.jpg`
- Bearbeiten (einzeln oder viele): Sterne, Tags, Aufnahmedatum, Fotograf; wird sofort in
  die Datei zurückgeschrieben
- Tag-Verwaltung: Gruppen und Tags anlegen, umbenennen, zusammenführen, löschen
- Papierkorb mit Wiederherstellen und endgültigem Löschen
- Anmeldung über Microsoft 365 (OpenID Connect) mit einfacher Rechteverwaltung
- Archiv-Abgleich: neue, geänderte und gelöschte Dateien auf der Platte werden in die
  Datenbank übernommen (manuell und nachts per Zeitplan)

## Technik

- Server: Node.js, Express 5, MariaDB, `sharp` (Vorschaubilder), `exiftool` (Metadaten)
- Weboberfläche: Vue 3 (Vite, Pinia, Vue Router)
- Anmeldung: `openid-client` (OIDC mit PKCE), Sitzungen über `express-session`

## Rahmenbedingungen und Grenzen

- Unterstützt wird **nur JPEG**. Andere Formate (HEIC, RAW, Video) werden nicht verarbeitet.
- Die Datei hat Vorrang: Ändert jemand eine Datei außerhalb der App (zum Beispiel mit Bridge),
  übernimmt der Abgleich deren Metadaten in die Datenbank.
- Der Abgleich entfernt keine Daten, wenn auf einmal sehr viele Dateien fehlen (zum Beispiel
  bei nicht eingebundener Freigabe). Dann bricht er ab und meldet es.
- Zugang haben nur Konten der konfigurierten Domäne (`ALLOWED_DOMAIN`). Alle dürfen ansehen,
  herunterladen und hochladen. Bearbeiten, Löschen, Tag-Verwaltung, Papierkorb und
  Nutzerverwaltung sind der Verwaltungsgruppe vorbehalten.
- Die App ist für den Betrieb hinter einem Reverse Proxy mit HTTPS gedacht und sollte nicht
  ohne Anmeldung erreichbar sein.
- Datenschutz: Fotos mit erkennbaren Personen unterliegen den Regeln der Schule (Einwilligungen).
  Die Fotos, die `.env` und Zugangsdaten gehören **nicht** ins Repository.

## Voraussetzungen

- Linux, Node.js 20.6 oder neuer (wegen `node --env-file`)
- MariaDB
- `exiftool` (Debian/Ubuntu: Paket `libimage-exiftool-perl`)
- Ein Microsoft-Entra-Mandant (oder ein anderer OIDC-Anbieter, zum Beispiel Keycloak)

## Installation (Entwicklung)

```bash
git clone https://github.com/Roemke/foto.git
cd foto

# Datenbank anlegen
sudo mysql -e "CREATE DATABASE schulfotos CHARACTER SET utf8mb4"
sudo mysql -e "CREATE USER 'schulfotos'@'localhost' IDENTIFIED BY 'PASSWORT'"
sudo mysql -e "GRANT ALL ON schulfotos.* TO 'schulfotos'@'localhost'"
mysql -u schulfotos -p schulfotos < server/db/schema.sql

# Server
cd server && npm install
# .env anlegen (siehe unten), dann:
node --watch --env-file=.env index.js

# Weboberfläche (zweites Terminal)
cd web && npm install && npm run dev
```

Die Weboberfläche läuft dann auf Port 5173 und leitet `/api` an den Server (Port 3000) weiter.

## Konfiguration (`server/.env`)

Die `.env` wird nicht versioniert. Sie enthält Geheimnisse.

| Variable | Bedeutung |
| --- | --- |
| `DB_*` | Zugang zur Datenbank (Namen siehe `server/db.js`) |
| `PHOTO_ROOT` | Wurzelordner der Fotos |
| `THUMB_DIR` | Cache für Vorschaubilder (darf jederzeit gelöscht werden) |
| `TRASH_DIR` | Papierkorb (Dateien behalten ihren relativen Pfad) |
| `UPLOAD_TMP` | optional, Zwischenablage für Uploads |
| `MAX_UPLOAD`, `MAX_ZIP` | optional, Höchstzahl Dateien pro Upload bzw. ZIP-Download (Standard 500) |
| `OIDC_ISSUER` | Entra: `https://login.microsoftonline.com/<Mandanten-ID>/v2.0` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | aus der App-Registrierung |
| `OIDC_REDIRECT_URI` | Entwicklung: `http://localhost:5173/api/auth/callback` |
| `ALLOWED_DOMAIN` | erlaubte Mail-Domäne, zum Beispiel `bkrheinbach.de` |
| `INITIAL_ADMINS` | kommagetrennte Mailadressen der ersten Verwalter |
| `SESSION_SECRET` | langer Zufallswert (`openssl rand -hex 32`) |
| `NEXTCLOUD_SCAN_CMD` | optional, wird nach dem Abgleich ausgeführt (Nextcloud-Scan) |

### Anmeldung einrichten (Microsoft Entra)

1. Entra-Admincenter, App-Registrierungen, neue Registrierung, nur dieser Mandant.
2. Umleitungs-URI (Plattform Web) eintragen, für den Betrieb zusätzlich die echte Adresse
   `https://<Adresse>/api/auth/callback`.
3. Client-Secret anlegen (höchstens 24 Monate Laufzeit, rechtzeitig erneuern).
4. Tokenkonfiguration: optionalen Anspruch `email` (ID-Token) hinzufügen.

Ein späterer Wechsel zu einem anderen OIDC-Anbieter (zum Beispiel Keycloak) erfolgt über die
vier `OIDC_*`-Variablen. Die Nutzer werden über ihre Mailadresse erkannt, sie muss dort gleich sein.

## Archiv-Abgleich

```bash
cd server
node --env-file=.env sync-cli.js --dry   # nur prüfen
node --env-file=.env sync-cli.js         # abgleichen
```

Manuell geht es auch in der App auf der Seite "Nutzer". Vorlagen für einen nächtlichen
Lauf mit systemd stehen in `deploy/`.

## Betrieb

Für den Produktivbetrieb ist ein Reverse Proxy mit HTTPS vorgesehen, der `/api` an den
Server (127.0.0.1:3000) weiterreicht und die gebaute Weboberfläche (`npm run build` in `web/`)
ausliefert. Die Vorlagen dafür sind noch nicht vorhanden.

## Lizenz

[MIT](LICENSE)
