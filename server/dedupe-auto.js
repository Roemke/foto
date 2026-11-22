import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const ROOT = process.env.PHOTO_ROOT;
const TRASH = process.env.TRASH_DIR;
const RUN = process.argv.includes('--run');
const PRIO = [
  'BilderBis2022Unsorted/ArchivBKRheinbachOnlyJPG/',
  'BilderBis2022Unsorted/archivWernerSchmickler/',
  'BilderBis2022Unsorted/BensDaten/',
];
const rank = (rel) => PRIO.findIndex((p) => rel.startsWith(p)) + 1;
const top2 = (rel) => rel.split('/').slice(0, 2).join('/');

async function moveFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
    await fs.unlink(src);
  }
}

async function freeName(dest) {
  const ext = path.extname(dest);
  const base = dest.slice(0, dest.length - ext.length);
  for (let n = 0; n < 1000; n++) {
    const cand = n ? `${base}-${n}${ext}` : dest;
    try {
      await fs.access(cand);
    } catch {
      return cand;
    }
  }
  throw new Error('Kein freier Dateiname');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});
const [rows] = await pool.query(
  'SELECT d.group_key AS k, p.id, p.rel_path AS rel, p.file_size AS size FROM duplicates d JOIN photos p ON p.rel_path = d.rel_path',
);
const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.k)) groups.set(r.k, []);
  groups.get(r.k).push(r);
}
const victims = [];
let skipped = 0;
let nGroups = 0;
for (const members of groups.values()) {
  if (members.length < 2) continue;
  nGroups++;
  members.sort((a, b) => rank(a.rel) - rank(b.rel) || (a.rel < b.rel ? -1 : 1));
  const keep = members[0];
  for (const v of members.slice(1)) {
    if (String(v.size) !== String(keep.size)) skipped++;
    else victims.push({ ...v, keep: keep.rel });
  }
}
const byFolder = {};
for (const v of victims) byFolder[top2(v.rel)] = (byFolder[top2(v.rel)] || 0) + 1;
const gb = Math.round(victims.reduce((t, v) => t + Number(v.size), 0) / 1e8) / 10;
console.log(JSON.stringify({ gruppen: nGroups, inPapierkorb: victims.length, gesamtGB: gb, uebersprungen: skipped, proOrdner: byFolder }, null, 2));
for (const v of victims.slice(0, 6)) console.log('behalte:', v.keep, '\n  weg:   ', v.rel);
if (!RUN) {
  console.log('Trockenlauf, nichts veraendert. Mit --run ausfuehren.');
  await pool.end();
  process.exit(0);
}
let moved = 0;
const failed = [];
for (const v of victims) {
  try {
    const dest = await freeName(path.join(TRASH, v.rel));
    await moveFile(path.join(ROOT, v.rel), dest);
    await pool.query('INSERT INTO trash (orig_rel_path, trash_rel_path) VALUES (?, ?)', [v.rel, path.relative(TRASH, dest)]);
    await pool.query('DELETE FROM photos WHERE id = ?', [v.id]);
    moved++;
    if (moved % 500 === 0) console.log('verschoben:', moved);
  } catch (e) {
    failed.push({ rel: v.rel, error: e.message });
  }
}
console.log(JSON.stringify({ verschoben: moved, fehler: failed.length, fehlerListe: failed.slice(0, 20) }, null, 2));
await pool.end();
