import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { loadTagCache, parseKeywords, linkTags } from './tags.js';

const run = promisify(execFile);
const ROOT = process.env.PHOTO_ROOT;
const thisYear = new Date().getFullYear();
const p2 = (n) => String(n).padStart(2, '0');

function mk(y, m, d, h = 0, mi = 0, s = 0, minYear = 1990) {
  y = +y; m = +m; d = +d; h = +h; mi = +mi; s = +s;
  if (y < minYear || y > thisYear + 1 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${p2(m)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(s)}`;
}

function fromExif(v) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? mk(m[1], m[2], m[3], m[4], m[5], m[6], 2000) : null;
}

function fromName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  for (const m of base.matchAll(/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?:[_-]?(\d{2})(\d{2})(\d{2}))?(?!\d)/g)) {
    const r = mk(m[1], m[2], m[3], m[4], m[5], m[6]);
    if (r) return r;
  }
  for (const m of base.matchAll(/(?<!\d)((?:19|20)\d{2})[._-](\d{2})[._-](\d{2})(?!\d)/g)) {
    const r = mk(m[1], m[2], m[3]);
    if (r) return r;
  }
  return null;
}

function fromFolder(relDir) {
  const segs = relDir.split(path.sep).reverse();
  for (const seg of segs) {
    let m = /(?<!\d)((?:19|20)\d{2})[._-](\d{2})[._-](\d{2})(?!\d)/.exec(seg);
    if (m) { const r = mk(m[1], m[2], m[3]); if (r) return [r, 'day']; }
    m = /(?<!\d)(\d{1,2})\.(\d{1,2})\.((?:19|20)?\d{2})(?!\d)/.exec(seg);
    if (m) {
      let y = +m[3];
      if (y < 100) y += y <= 30 ? 2000 : 1900;
      const r = mk(y, m[2], m[1]);
      if (r) return [r, 'day'];
    }
    m = /(?<!\d)((?:19|20)\d{2})\.(\d{2})(?!\d)/.exec(seg);
    if (m) { const r = mk(m[1], m[2], 1); if (r) return [r, 'month']; }
    m = /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(seg);
    if (m) { const r = mk(m[1], 1, 1); if (r) return [r, 'year']; }
  }
  return null;
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const tagCache = await loadTagCache(conn);

const files = fs
  .readdirSync(ROOT, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.jpe?g$/i.test(e.name) && !e.name.startsWith('._'))
  .map((e) => path.join(e.parentPath ?? e.path, e.name));
console.log(`${files.length} JPEG-Dateien gefunden`);

const SQL = `INSERT INTO photos
  (rel_path, file_name, width, height, file_size, file_mtime, taken_at, date_source, date_precision, rating)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE width = VALUES(width), height = VALUES(height),
    file_size = VALUES(file_size), file_mtime = VALUES(file_mtime)`;

let done = 0;
for (let i = 0; i < files.length; i += 100) {
  const batch = files.slice(i, i + 100);
  let out;
  try {
    ({ stdout: out } = await run(
      'exiftool',
      ['-json', '-charset', 'filename=utf8', '-charset', 'iptc=MacRoman', '-Rating', '-DateTimeOriginal', '-CreateDate',
       '-ImageWidth', '-ImageHeight', '-HierarchicalSubject', '-Subject', '-Keywords', ...batch],
      { maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (e) {
    out = e.stdout;
  }
  for (const it of JSON.parse(out || '[]')) {
    const rel = path.relative(ROOT, it.SourceFile);
    const st = fs.statSync(it.SourceFile);
    const name = path.basename(rel);
    let taken = fromExif(it.DateTimeOriginal) ?? fromExif(it.CreateDate);
    let src = taken ? 'exif' : null;
    let prec = 'day';
    if (!taken) { taken = fromName(name); if (taken) src = 'filename'; }
    if (!taken) {
      const f = fromFolder(path.dirname(rel));
      if (f) { [taken, prec] = f; src = 'folder'; }
    }
    if (!taken) { taken = st.mtime; src = 'mtime'; }
    const rating = Number(it.Rating) > 0 ? Number(it.Rating) : null;
    const [res] = await conn.query(SQL, [rel, name, it.ImageWidth ?? null, it.ImageHeight ?? null,
      st.size, st.mtime, taken, src, prec, rating]);
    if (res.affectedRows === 1) {
      const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      const entries = parseKeywords(list(it.HierarchicalSubject), (it.Subject != null ? list(it.Subject) : list(it.Keywords)));
      await linkTags(conn, tagCache, res.insertId, entries);
    }
    done++;
  }
  process.stdout.write(`\r${done}/${files.length}`);
}
console.log('\nfertig');
await conn.end();
