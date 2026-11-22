# Schulfotos

Webanwendung zur Verwaltung des Foto-Archivs einer Schule. Sie ersetzt die bisherige Kombination aus Adobe Bridge und einem Netzlaufwerk (Nextcloud): Fotos lassen sich im Browser ansehen, filtern, herunterladen und hochladen. Bewertung und Verschlagwortung stehen direkt in den JPEG-Dateien (XMP), die Datenbank ist nur ein Index.

## Funktionen

- Anmeldung mit Microsoft 365 (Entra ID, OpenID Connect), nur Konten einer festgelegten Domain
- Rollen: **Nutzer** (ansehen, herunterladen, hochladen) und **Admin** (zusätzlich Metadaten bearbeiten, löschen, Tags und Nutzer verwalten)
- Foto-Raster mit Filtern (u. a. nach Zeitraum und Tags) und Großansicht
- Upload von Fotos
- Papierkorb mit Wiederherstellung
- Tag-Verwaltung, auch zum Übernehmen von Alt-Tags aus den Fotos in die kuratierte Liste
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
- Die Papierkorb-Seite zeigt nur die neuesten 1000 Einträge.
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

**Prozessor (virtuelle Maschinen)**

Die Bibliothek `sharp` (Thumbnails) bringt für Linux x64 fertige Programme
mit, die einen Prozessor mit SSE4.2 voraussetzen (Mikroarchitektur
`x86-64-v2`). Läuft der Server als virtuelle Maschine, darf deren CPU-Typ
nicht zu einfach sein. Der Proxmox-Typ `kvm64` genügt nicht, der Dienst
bricht dann beim Start mit dieser Meldung ab:

```
Could not load the "sharp" module using the linux-x64 runtime
Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture
```

In Proxmox den CPU-Typ der VM auf `x86-64-v2-AES` (oder `host`) stellen und
die VM komplett herunterfahren und neu starten. Prüfen im Gastsystem:

```bash
grep -m1 -qw sse4_2 /proc/cpuinfo && echo ok
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
Dort steht auch, wo `MANDANTEN-ID` und `ANWENDUNGS-ID` zu finden sind (Übersichtsseite der Registrierung: „Directory (tenant) ID“ und „Application (client) ID“).

Cache und Papierkorb liegen außerhalb des Archivs und müssen für den Dienstbenutzer beschreibbar sein. Der Papierkorb gehört am besten auf dasselbe Dateisystem wie das Archiv, sonst wird beim Löschen kopiert statt verschoben und der Platz dort muss reichen. Im Beispiel liegen beide unter `/var`:

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

**Beispiel: vorgeschalteter Apache-Proxy mit Let's Encrypt**

Der Proxy beendet TLS und reicht die Anfragen per HTTP an den Server weiter.
Zuerst ein Block für Port 80 (Zertifikatsprüfung und Umleitung auf HTTPS),
in `/etc/apache2/sites-available/fotos.conf` des Proxys:

```
<VirtualHost *:80>
    ServerName fotos.bk-rheinbach.net

    Alias /.well-known/acme-challenge/ /var/www/html/.well-known/acme-challenge/
    <Directory /var/www/html/.well-known/acme-challenge/>
        Require all granted
    </Directory>

    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/.well-known/acme-challenge/
    RewriteRule ^(.*)$ https://%{HTTP_HOST}$1 [R=301,L]
</VirtualHost>
```

Seite aktivieren und neu laden (`a2ensite`, `apache2ctl configtest`,
`systemctl reload apache2`), den DNS-Eintrag für den Namen anlegen und dann
das Zertifikat holen:

```bash
sudo certbot certonly --webroot -w /var/www/html -d fotos.bk-rheinbach.net
```

Danach den Block für Port 443 an dieselbe Datei anhängen. `ADRESSE-DES-SERVERS`
ist die Adresse des Servers mit der App aus Sicht des Proxys:

```
<VirtualHost *:443>
    ServerName fotos.bk-rheinbach.net

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/fotos.bk-rheinbach.net/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/fotos.bk-rheinbach.net/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf

    ProxyPreserveHost On
    ProxyPass / http://ADRESSE-DES-SERVERS/
    ProxyPassReverse / http://ADRESSE-DES-SERVERS/

    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
```

`X-Forwarded-Proto` muss fest gesetzt werden, `mod_proxy` liefert diesen
Header nicht selbst. WebSockets braucht die Anwendung nicht. Die Module
`proxy`, `proxy_http`, `headers`, `rewrite` und `ssl` müssen auf dem Proxy
aktiv sein. Test von außen:

```bash
curl -si https://fotos.bk-rheinbach.net/api/health | head -1
```

Erwartet: `HTTP/1.1 200 OK`.

### 7. Archiv einlesen (Abgleich)

Zuerst einmalig die Stichwortliste anlegen (`server/db/stichwoerter.txt`). Das muss vor dem ersten Abgleich geschehen. Beim Hochladen bietet die App nur Stichwörter an, die nicht als „Alt“ markiert sind, also die aus der Liste und die in der App neu angelegten. Stichwörter, die der Import in den Fotos findet und die nicht in der Liste stehen, gelten als „Alt“ und werden beim Hochladen nicht angeboten. In der Tag-Verwaltung lässt sich ein Alt-Tag mit „Übernehmen“ in die kuratierten Tags übernehmen.

```bash
cd /opt/fotos/server && sudo -u www-data node --env-file=.env db/seed-tags.js
```

Erwartet: eine Zeile `Gruppen: …, Tags: …`.

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

Das Ergebnis am Ende des Laufs im Journal prüfen: `errors` und `notes` müssen leer sein, `added` entspricht der Zahl der JPEG-Dateien. Die Notiz „Ordner nicht lesbar: nichts wird entfernt“ bedeutet, dass der Dienstbenutzer einen Ordner oder eine Datei nicht lesen konnte. Die betroffenen Fotos fehlen dann in der Datenbank. Ein Beispiel ist ein Ordner ohne Execute-Recht (`chmod 755 ORDNER`). Danach den Abgleich erneut starten, er holt die fehlenden Dateien nach.

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
| `NEXTCLOUD_SCAN_PATH_CMD` | optional, Befehl für einen Nextcloud-Scan nur der Upload-Ordner, der Pfad wird als letztes Argument angehängt, z. B. `php /var/www/html/gfscloud/occ groupfolders:scan 1 -p` |
| `NEXTCLOUD_SCAN_PATH_PREFIX` | optional, Pfad des Archivs innerhalb des Gruppenordners, z. B. `/Bilder` |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` | Zugang zur MariaDB-Datenbank |
| `THUMB_DIR` | Verzeichnis für den Thumbnail-Cache, muss für den Dienst beschreibbar sein |
| `UPLOAD_TMP` | optional, Zwischenverzeichnis für Uploads (Standard: temporäres Verzeichnis des Systems) |
| `MAX_UPLOAD` | optional, höchstens so viele Dateien pro Upload (Standard 500) |
| `MAX_ZIP` | optional, höchstens so viele Fotos pro ZIP-Download (Standard 500) |
| `WEB_DIST` | optional, Ordner der gebauten Oberfläche (Standard `../web/dist`, relativ zum Server-Verzeichnis) |

## Anmeldung mit Microsoft Entra

Die Anwendung meldet Nutzer über OpenID Connect an. Dafür braucht es eine
App-Registrierung im Microsoft Entra Admin Center (mindestens die Rolle
„Cloud-Anwendungsadministrator“).

### Registrierung anlegen

1. Im Entra Admin Center unter *Identity > Applications > App registrations*
   „New registration“ wählen.
2. Einen Namen vergeben, z. B. „Schulfotos“. Bei „Supported account types“
   „Accounts in this organizational directory only“ wählen (nur das eigene
   Verzeichnis). Als Plattform „Web“ mit der Redirect-URI
   `https://fotos.bk-rheinbach.net/api/auth/callback` eintragen und
   „Register“ drücken.
3. Auf der Übersichtsseite zwei Werte notieren:
   - „Application (client) ID“ ergibt `OIDC_CLIENT_ID`
   - „Directory (tenant) ID“ (die Mandanten-ID) gehört in `OIDC_ISSUER`
4. Weitere Redirect-URIs (z. B. für die Entwicklung
   `http://localhost:5173/api/auth/callback`) unter *Manage > Authentication*
   über „Add a platform“ oder bei der Plattform „Web“ ergänzen. Es können
   mehrere URIs eingetragen sein.
5. Unter *Certificates & secrets > Client secrets > New client secret* ein
   Clientgeheimnis anlegen: Beschreibung eintragen, Laufzeit wählen (höchstens
   24 Monate). Der **Wert** des Geheimnisses wird nur direkt nach dem Anlegen
   angezeigt und ergibt `OIDC_CLIENT_SECRET`. Die „Secret ID“ ist nicht gemeint.
   Das Ablaufdatum notieren und das Geheimnis rechtzeitig erneuern.
6. Unter *Manage > Token configuration > Add optional claim* den Token-Typ
   „ID“ wählen und den Anspruch `email` hinzufügen. Im Dialog die Frage nach der
   Microsoft-Graph-Berechtigung „email“ mit dem Häkchen bestätigen.

### Bereits vorhandene Registrierung

Wurde die Registrierung schon für die Entwicklung angelegt, genügt es, die
Redirect-URI der Produktion zu ergänzen (Schritt 4). Client-ID und Geheimnis
lassen sich weiterverwenden, oder der Server bekommt ein eigenes Geheimnis.

### Werte in `server/.env`

```
OIDC_ISSUER=https://login.microsoftonline.com/MANDANTEN-ID/v2.0
OIDC_CLIENT_ID=ANWENDUNGS-ID
OIDC_CLIENT_SECRET=WERT-DES-GEHEIMNISSES
OIDC_REDIRECT_URI=https://fotos.bk-rheinbach.net/api/auth/callback
```

`OIDC_REDIRECT_URI` muss **exakt** mit einer der in Entra eingetragenen
Redirect-URIs übereinstimmen.

Als Identität dient die Mail-Adresse in Kleinschreibung. Ein Wechsel zu einem
anderen OIDC-Anbieter (z. B. Keycloak) erfordert nur geänderte
`OIDC_*`-Werte, die Mail-Adressen müssen übereinstimmen.

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

### Altarchive aufräumen (einmalig)

`server/dedupe-auto.js` räumt nach dem ersten Import Dubletten in Altarchiven auf: Pro Gruppe bleibt eine Datei, die übrigen gehen in den Papierkorb der App (rückholbar). Welche Ordner als Altarchive gelten und welche bei Dubletten immer verlieren, steht am Anfang des Skripts (`PRIO`, `LOSE`). Das ist auf die Ordner der Schule zugeschnitten und vor der Verwendung anzupassen. Ohne `--run` ist es ein Trockenlauf:

```bash
cd /opt/fotos/server
sudo -u www-data node --env-file=.env dedupe-auto.js          # Trockenlauf
sudo -u www-data node --env-file=.env dedupe-auto.js --run    # ausführen
```

Danach den Abgleich einmal starten, damit Nextcloud die entfernten Dateien mitbekommt.

## Autor

Karsten Römke. Das Projekt ist mit sehr starker Unterstützung von Claude (Anthropic) entstanden: Konzept, Code und Dokumentation wurden im Dialog mit Claude entwickelt.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
