# Deployment-Vorlagen (ungetestet, vor Gebrauch anpassen)

## Nächtlicher Abgleich
1. Dateien nach /etc/systemd/system/ kopieren, Pfade und User in der .service anpassen.
2. `systemctl daemon-reload && systemctl enable --now schulfotos-sync.timer`
3. Prüfen: `systemctl list-timers schulfotos-sync.timer`, Log: `journalctl -u schulfotos-sync.service`
4. Manuell starten: `systemctl start schulfotos-sync.service`

## Nextcloud-Scan (optional, in server/.env)
Läuft der Dienst als www-data:
NEXTCLOUD_SCAN_CMD=php /var/www/nextcloud/occ groupfolders:scan 1
Sonst mit sudo -u www-data davor. Pfad zu occ und Ordner-ID prüfen
(`occ groupfolders:list`).
