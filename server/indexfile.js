import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTagCache, parseKeywords, linkTags } from './tags.js';
import { fromExif, fromName, fromFolder } from './dates.js';

const run = promisify(execFile);
const ROOT = process.env.PHOTO_ROOT;
const FIELDS = [
  '-Rating', '-DateTimeOriginal', '-CreateDate', '-ImageWidth', '-ImageHeight',
  '-HierarchicalSubject', '-Subject', '-Keywords', '-XMP-dc:Creator',
];
const SQL = `INSERT INTO photos
  (rel_path, file_name, width, height, file_size, file_mtime, taken_at, date_source, date_precision, rating, photographer)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE width = VALUES(width), height = VALUES(height),
    file_size = VALUES(file_size), file_mtime = VALUES(file_mtime)`;
const REFRESH_SQL = `INSERT INTO photos
  (rel_path, file_name, width, height, file_size, file_mtime, taken_at, date_source, date_precision, rating, photographer)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), width = VALUES(width), height = VALUES(height),
    file_size = VALUES(file_size), file_mtime = VALUES(file_mtime), taken_at = VALUES(taken_at),
    date_source = VALUES(date_source), date_precision = VALUES(date_precision),
    rating = VALUES(rating), photographer = VALUES(photographer)`;
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export async function indexFiles(pool, rels, opts = {}) {
  const tagCache = await loadTagCache(pool);
  const abs = rels.map((r) => path.join(ROOT, r));
  let out;
  try {
    ({ stdout: out } = await run(
      'exiftool',
      ['-json', '-charset', 'filename=utf8', '-charset', 'iptc=MacRoman', ...FIELDS, ...abs],
      { maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (e) {
    out = e.stdout;
  }
  const meta = new Map();
  for (const it of JSON.parse(out || '[]')) meta.set(path.resolve(it.SourceFile), it);

  const results = [];
  for (const rel of rels) {
    try {
      const file = path.join(ROOT, rel);
      const it = meta.get(path.resolve(file)) ?? {};
      if (opts.refresh && !meta.has(path.resolve(file))) throw new Error('exiftool lieferte keine Daten');
      const st = await fs.stat(file);
      const name = path.basename(rel);
      let taken = fromExif(it.DateTimeOriginal) ?? fromExif(it.CreateDate);
      let src = taken ? 'exif' : null;
      let prec = 'day';
      if (!taken) {
        taken = fromName(name);
        if (taken) src = 'filename';
      }
      if (!taken) {
        const f = fromFolder(path.dirname(rel));
        if (f) {
          [taken, prec] = f;
          src = 'folder';
        }
      }
      if (!taken) {
        taken = st.mtime;
        src = 'mtime';
      }
      const rating = Number(it.Rating) > 0 ? Number(it.Rating) : null;
      const photographer = String(list(it.Creator)[0] ?? '').slice(0, 100) || null;
      const [res] = await pool.query(opts.refresh ? REFRESH_SQL : SQL, [
        rel, name, it.ImageWidth ?? null, it.ImageHeight ?? null,
        st.size, st.mtime, taken, src, prec, rating, photographer,
      ]);
      if (opts.refresh || res.affectedRows === 1) {
        if (opts.refresh) await pool.query('DELETE FROM photo_tags WHERE photo_id = ?', [res.insertId]);
        const entries = parseKeywords(
          list(it.HierarchicalSubject),
          it.Subject != null ? list(it.Subject) : list(it.Keywords),
        );
        await linkTags(pool, tagCache, res.insertId, entries);
      }
      results.push({ rel });
    } catch (e) {
      results.push({ rel, error: e.message });
    }
  }
  return results;
}
