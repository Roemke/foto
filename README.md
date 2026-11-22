# Schulfotos

Webanwendung zur Verwaltung des Foto-Archivs einer Schule. Sie ersetzt die bisherige Kombination aus Adobe Bridge und einem Netzlaufwerk (Nextcloud): Fotos lassen sich im Browser ansehen, filtern, herunterladen und hochladen. Bewertung und Verschlagwortung stehen direkt in den JPEG-Dateien (XMP), die Datenbank ist nur ein Index.

## Funktionen

- Anmeldung mit Microsoft 365 (Entra ID, OpenID Connect), nur Konten einer festgelegten Domain
- Rollen: **Nutzer** (ansehen, herunterladen, hochladen) und **Admin** (zusätzlich Metadaten bearbeiten, löschen, Tags und Nutzer verwalten)
- Foto-Raster mit Filtern (u. a. nach Zeitraum und Tags) und Großansicht
- Upload von Fotos
- Papierkorb mit Wiederherstellung
- Tag-Verwaltung
- Nutzerverwaltung (Admin)
- Archiv-Abgleich zwischen Dateisystem und Datenbank, nächtlich und manuell auslösbar
- Dublettenerkennung mit Verwaltungsseite zum Aufräumen
- Seiten für Impressum und Datenschutz

## Technik

- Server: Node.js, Express 5, `openid-client`, `express-session`, `sharp` (Thumbnails), `exiftool` (Metadaten)
- Oberfläche: Vue 3 mit Vite, Pinia und Vue Router
- Datenbank: MariaDB

## Prinzipien

- Die Datei ist maßgeblich. Rating, Schlagwörter (auch hierarchisch) und Fotograf stehen im XMP der JPEG-Datei. Bei Abweichungen zwischen Datei und Datenbank gilt die Datei.
- Fotos gehören nicht ins Repository, ebenso wenig die Datei `.env`.

## Grenzen

- Nur JPEG. Andere Formate (z. B. HEIC) werden noch nicht unterstützt.
- Sitzungen liegen im Arbeitsspeicher. Nach einem Neustart des Servers müssen sich alle Nutzer neu anmelden.
- Zugriff hat jedes Konto der erlaubten Domain. Eine Prüfung der Gruppenmitgliedschaft gibt es nicht.
- Dubletten sind byte-identische Dateien. Ein verkleinertes oder neu gespeichertes Foto gilt als anderes Foto.
- Impressum und Datenschutzerklärung sind Entwurfstexte und müssen vor dem Produktivbetrieb geprüft werden.

## Installation

Die Anleitung beschreibt den Betrieb hinter einem Reverse Proxy auf einem Ubuntu-Server mit Apache. Beispielwerte: Adresse `fotos.bk-rheinbach.net`, Installation unter `/opt/fotos`, Dienstbenutzer `www-data`, Archiv in einem Nextcloud-Gruppenordner. Alle Befehle werden mit `sudo` ausgeführt.

```
Browser --HTTPS--> Proxy (hier schulix), TLS endet dort
Proxy   --HTTP---> Apache auf dem Server
Apache  --HTTP---> Node-Dienst (127.0.0.1:3000)
```

Der Node-Dienst liefert Oberfläche und API selbst aus, ein zusätzlicher
Webserver für die Dateien ist nicht nötig. Der Apache leitet nur weiter.

**Vor dem Start:** Sicherung des Archivs anlegen. Die Anwendung schreibt Metadaten in die JPEG-Dateien und verschiebt gelöschte Fotos in den Papierkorb.

### 1. Voraussetzungen

- Git
- Node.js `^20.19` oder `>=22.12` (Vorgabe von Vite für den Build; der Server nutzt außerdem `--env-file`), Installation siehe unten
- MariaDB
- exiftool (Ubuntu: `sudo apt install libimage-exiftool-perl`)
- Apache mit den Modulen `proxy`, `proxy_http` und `headers`:

```bash
node -v; mysql --version; exiftool -ver; apache2 -v | head -1; git --version
```


```bash
sudo a2enmod proxy proxy_http headers
```

**Node.js installieren (Ubuntu)**

Auf dem Beispielserver (Ubuntu 24.04) liefert `apt` nur Node 18.19.1. Das ist
für den Build zu alt (Vite verlangt `^20.19` oder `>=22.12`). Daher kommt Node
24 (LTS) aus dem NodeSource-Repository. Es liegt danach unter `/usr/bin/node`,
wie es die Dienstdatei erwartet. `nvm` eignet sich dafür nicht, weil der Dienst
als `www-data` läuft und nicht an einen Node-Pfad im Home-Verzeichnis kommt.

Das Skript vor dem Ausführen ansehen. Bei der Installation prüfen, welche
Pakete `apt` entfernen will, bevor sie bestätigt wird.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
less nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install nodejs
node -v
```

### 2. Code holen und bauen

```bash
sudo git clone https://github.com/Roemke/foto.git /opt/fotos
cd /opt/fotos/server && sudo npm install --omit=dev
cd /opt/fotos/web && sudo npm install && sudo npm run build
```

Das Ergebnis des Frontend-Builds liegt in `/opt/fotos/web/dist`. Der Node-Dienst liefert diesen Ordner selbst aus (Standard `../web/dist`, änderbar mit `WEB_DIST`).

### 3. Datenbank

`PASSWORT` durch ein eigenes ersetzen.

```bash
sudo mysql -e "CREATE DATABASE schulfotos CHARACTER SET utf8mb4; CREATE USER 'schulfotos'@'localhost' IDENTIFIED BY 'PASSWORT'; GRANT ALL ON schulfotos.* TO 'schulfotos'@'localhost';"
sudo mysql schulfotos < /opt/fotos/server/db/schema.sql
```

### 4. Verzeichnisse und Konfiguration

Die App-Registrierung in Entra (Abschnitt „Anmeldung mit Microsoft Entra“) muss vorher vorhanden sein, mit der Redirect-URI `https://fotos.bk-rheinbach.net/api/auth/callback`.

Cache und Papierkorb liegen außerhalb des Archivs und müssen für den Dienstbenutzer beschreibbar sein:

```bash
sudo mkdir -p /var/cache/schulfotos /var/lib/schulfotos/papierkorb
sudo chown -R www-data:www-data /var/cache/schulfotos /var/lib/schulfotos
```

Konfiguration anlegen. Die Platzhalter in Großbuchstaben ersetzen, `SESSION_SECRET` mit `openssl rand -hex 32` erzeugen. Die Bedeutung aller Variablen steht im Abschnitt „Konfiguration“.

```bash
sudo tee /opt/fotos/server/.env > /dev/null <<'EOF'
DB_HOST=127.0.0.1
DB_USER=schulfotos
DB_PASS=PASSWORT
DB_NAME=schulfotos
PHOTO_ROOT=/home/lehrer/gfsCloudData/__groupfolders/1/Bilder
THUMB_DIR=/var/cache/schulfotos
TRASH_DIR=/var/lib/schulfotos/papierkorb
OIDC_ISSUER=https://login.microsoftonline.com/MANDANTEN-ID/v2.0
OIDC_CLIENT_ID=ANWENDUNGS-ID
OIDC_CLIENT_SECRET=CLIENTGEHEIMNIS
OIDC_REDIRECT_URI=https://fotos.bk-rheinbach.net/api/auth/callback
ALLOWED_DOMAIN=bkrheinbach.de
INITIAL_ADMINS=ADMIN@bkrheinbach.de
SESSION_SECRET=ZUFALLSWERT
NEXTCLOUD_SCAN_CMD=php /var/www/html/gfscloud/occ groupfolders:scan 1
EOF
sudo chown root:www-data /opt/fotos/server/.env && sudo chmod 640 /opt/fotos/server/.env
```

Prüfen, ob der Dienstbenutzer im Archiv schreiben darf:

```bash
sudo -u www-data test -w /home/lehrer/gfsCloudData/__groupfolders/1/Bilder && echo schreibbar
```

### 5. Dienst einrichten (systemd)

Den Pfad zu Node vorher mit `which node` prüfen.

```bash
sudo tee /etc/systemd/system/schulfotos.service > /dev/null <<'EOF'
[Unit]
Description=Schulfotos (Node/Express)
After=network.target mariadb.service

[Service]
User=www-data
WorkingDirectory=/opt/fotos/server
ExecStart=/usr/bin/node --env-file=.env index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now schulfotos
curl -si http://127.0.0.1:3000/api/health | head -1
```

Erwartet: `HTTP/1.1 200 OK`. Das Log steht unter `journalctl -u schulfotos -f`.

### 6. Apache einrichten

Der Apache leitet alles an den Node-Dienst weiter, der Oberfläche und API
ausliefert. Da TLS auf dem vorgeschalteten Proxy endet, setzt der Apache
`X-Forwarded-Proto` fest auf `https`. Der Server leitet Protokoll und Host
aus diesen Headern ab (`trust proxy`).

```bash
sudo tee /etc/apache2/sites-available/fotos.conf > /dev/null <<'EOF'
<VirtualHost *:80>
    ServerName fotos.bk-rheinbach.net
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3000/
    ProxyPassReverse / http://127.0.0.1:3000/
    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
EOF
sudo a2ensite fotos && sudo apache2ctl configtest && sudo systemctl reload apache2
curl -si -H 'Host: fotos.bk-rheinbach.net' http://127.0.0.1/api/health | head -1
curl -s -H 'Host: fotos.bk-rheinbach.net' http://127.0.0.1/ | head -3
```

Erwartet: `HTTP/1.1 200 OK` und der Anfang der HTML-Seite.

Der vorgeschaltete Proxy (hier schulix) muss `fotos.bk-rheinbach.net` per HTTP
an den Apache dieses Servers weiterleiten und den Host-Header unverändert
lassen. Das Zertifikat und der DNS-Eintrag gehören ebenfalls dorthin. Im
lokalen Netz muss der Name intern auf denselben Proxy zeigen, nicht direkt auf
den Server, damit auch dort HTTPS genutzt wird. Danach lässt sich die
Anmeldung im Browser unter `https://fotos.bk-rheinbach.net` testen.

### 7. Archiv einlesen (Abgleich)

Die Vorlagen für den Abgleich liegen in `deploy/`. Zuerst ein Trockenlauf, der auch die Schreibrechte und die Konfiguration prüft. Er kann bei großen Archiven dauern, daher mit niedriger Priorität:

```bash
sudo cp /opt/fotos/deploy/schulfotos-sync.service /opt/fotos/deploy/schulfotos-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
cd /opt/fotos/server && sudo -u www-data nice -n 19 ionice -c3 node --env-file=.env sync-cli.js --dry
```

Erwartet: JSON-Ausgabe, `added` entspricht der Zahl der JPEG-Dateien im Archiv. Danach der erste echte Lauf im Hintergrund und der nächtliche Timer:

```bash
sudo systemctl start --no-block schulfotos-sync.service
journalctl -u schulfotos-sync.service -f
sudo systemctl enable --now schulfotos-sync.timer
```

### 8. Erste Anmeldung

Im Browser `https://fotos.bk-rheinbach.net` öffnen und mit einem Konto aus `INITIAL_ADMINS` anmelden. Weitere Admins pflegt die App unter „Nutzer“.

## Konfiguration (`server/.env`)

| Variable | Bedeutung |
| --- | --- |
| `PHOTO_ROOT` | Wurzelverzeichnis des Foto-Archivs |
| `TRASH_DIR` | Verzeichnis für den Papierkorb (außerhalb des Archivs) |
| `OIDC_ISSUER` | z. B. `https://login.microsoftonline.com/<Mandanten-ID>/v2.0` |
| `OIDC_CLIENT_ID` | Anwendungs-ID aus der App-Registrierung |
| `OIDC_CLIENT_SECRET` | Clientgeheimnis, nur in `.env`, nie im Repository |
| `OIDC_REDIRECT_URI` | z. B. `https://HOST/api/auth/callback` |
| `ALLOWED_DOMAIN` | erlaubte Mail-Domain, z. B. `bkrheinbach.de` |
| `INITIAL_ADMINS` | Mail-Adressen der ersten Admins, danach Pflege in der App |
| `SESSION_SECRET` | langer Zufallswert, z. B. `openssl rand -hex 32` |
| `NEXTCLOUD_SCAN_CMD` | optional, Befehl für einen Nextcloud-Scan nach dem Abgleich |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` | Zugang zur MariaDB-Datenbank |
| `THUMB_DIR` | Verzeichnis für den Thumbnail-Cache, muss für den Dienst beschreibbar sein |
| `UPLOAD_TMP` | optional, Zwischenverzeichnis für Uploads (Standard: temporäres Verzeichnis des Systems) |
| `MAX_UPLOAD` | optional, höchstens so viele Dateien pro Upload (Standard 500) |
| `MAX_ZIP` | optional, höchstens so viele Fotos pro ZIP-Download (Standard 500) |
| `WEB_DIST` | optional, Ordner der gebauten Oberfläche (Standard `../web/dist`, relativ zum Server-Verzeichnis) |

## Anmeldung mit Microsoft Entra

1. In Entra eine App-Registrierung anlegen, Plattform „Web“, Redirect-URI wie `OIDC_REDIRECT_URI` (Entwicklung: `http://localhost:5173/api/auth/callback`).
2. Ein Clientgeheimnis erzeugen. Die Laufzeit ist auf höchstens 24 Monate begrenzt, danach muss es erneuert werden.
3. Unter „Token-Konfiguration“ den optionalen Anspruch `email` für das ID-Token hinzufügen und die Graph-Berechtigung „email“ bestätigen.

Als Identität dient die Mail-Adresse in Kleinschreibung. Ein Wechsel zu einem anderen OIDC-Anbieter (z. B. Keycloak) erfordert nur geänderte `OIDC_*`-Werte, die Mail-Adressen müssen übereinstimmen.

## Archiv-Abgleich

Der Abgleich vergleicht das Archiv mit der Datenbank: neue Dateien werden aufgenommen, geänderte neu eingelesen, fehlende entfernt. Dabei werden auch neue Dubletten erfasst. Sicherungen verhindern, dass bei einem nicht eingebundenen Archiv die Datenbank geleert wird.

```bash
cd server
node --env-file=.env sync-cli.js --dry    # nur prüfen
node --env-file=.env sync-cli.js          # abgleichen
node --env-file=.env sync-cli.js --force  # auch bei vielen fehlenden Dateien entfernen
```

Ein systemd-Timer für den nächtlichen Lauf liegt in `deploy/`. In der App lässt sich der Abgleich unter „Nutzer“ manuell starten.

Wurden Dateien außerhalb von Nextcloud verändert, muss Nextcloud sie neu einlesen. Dafür dient `NEXTCLOUD_SCAN_CMD`, bei Gruppenordnern z. B. `occ groupfolders:scan`.

## Autor

Karsten Römke. Das Projekt ist mit sehr starker Unterstützung von Claude (Anthropic) entstanden: Konzept, Code und Dokumentation wurden im Dialog mit Claude entwickelt.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
