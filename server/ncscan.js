import { execFile } from 'node:child_process';
import path from 'node:path';

// Scannt die Ordner der übergebenen Dateien in Nextcloud (im Hintergrund, nacheinander).
// NEXTCLOUD_SCAN_PATH_CMD: Befehl, an den der Pfad als letztes Argument angehängt wird.
// NEXTCLOUD_SCAN_PATH_PREFIX: Pfad des Archivs innerhalb des Gruppenordners, z. B. /Bilder
export function scanNextcloud(rels) {
  const cmd = process.env.NEXTCLOUD_SCAN_PATH_CMD;
  if (!cmd || !rels.length) return;
  const prefix = process.env.NEXTCLOUD_SCAN_PATH_PREFIX || '';
  const dirs = [...new Set(rels.map((r) => path.dirname(r)))];
  (async () => {
    for (const d of dirs) {
      await new Promise((resolve) => {
        execFile(
          'sh',
          ['-c', cmd + ' "$1"', 'scan', `${prefix}/${d}`],
          { timeout: 300_000 },
          (err) => {
            if (err) console.error('Nextcloud-Scan fehlgeschlagen', d, err.message);
            resolve();
          },
        );
      });
    }
  })();
}
