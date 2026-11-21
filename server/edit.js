import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = process.env.PHOTO_ROOT;
const ids = (v) =>
  (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export function makeEditRouter(pool) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.post('/', async (req, res) => {
    const photoIds = ids(req.body.ids);
    const add = ids(req.body.addTags);
    const remove = ids(req.body.removeTags);
    const hasRating = req.body.rating !== undefined;
    let rating = null;
    if (hasRating && req.body.rating !== null) {
      rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
        return res.status(400).json({ error: 'Sterne ungültig' });
      }
      if (rating === 0) rating = null;
    }
    if (!photoIds.length || photoIds.length > 500) {
      return res.status(400).json({ error: 'Ungültige Auswahl (1 bis 500 Fotos)' });
    }
    if (!hasRating && !add.length && !remove.length) {
      return res.status(400).json({ error: 'Nichts zu ändern' });
    }

    const wanted = [...new Set([...add, ...remove])];
    const info = new Map();
    if (wanted.length) {
      const [rows] = await pool.query(
        `SELECT t.id, t.name, g.name AS gname
         FROM tags t JOIN tag_groups g ON g.id = t.group_id WHERE t.id IN (?)`,
        [wanted],
      );
      for (const r of rows) info.set(r.id, r);
    }
    const addInfo = add.map((i) => info.get(i)).filter(Boolean);
    const remInfo = remove.map((i) => info.get(i)).filter(Boolean);

    if (hasRating) {
      await pool.query('UPDATE photos SET rating = ? WHERE id IN (?)', [rating, photoIds]);
    }
    if (addInfo.length) {
      await pool.query('INSERT IGNORE INTO photo_tags (photo_id, tag_id) VALUES ?', [
        photoIds.flatMap((p) => addInfo.map((t) => [p, t.id])),
      ]);
    }
    if (remInfo.length) {
      await pool.query('DELETE FROM photo_tags WHERE photo_id IN (?) AND tag_id IN (?)', [
        photoIds,
        remInfo.map((t) => t.id),
      ]);
    }

    const args = [];
    if (hasRating) args.push(rating ? `-XMP:Rating=${rating}` : '-XMP:Rating=');
    for (const t of addInfo) {
      args.push(`-XMP-dc:Subject+=${t.name}`, `-XMP-lr:HierarchicalSubject+=${t.gname}|${t.name}`);
    }
    for (const t of remInfo) {
      args.push(`-XMP-dc:Subject-=${t.name}`, `-XMP-lr:HierarchicalSubject-=${t.gname}|${t.name}`);
    }

    const [photos] = await pool.query('SELECT id, rel_path FROM photos WHERE id IN (?)', [photoIds]);
    const fileErrors = [];
    for (let i = 0; i < photos.length; i += 50) {
      const batch = photos.slice(i, i + 50);
      try {
        await run(
          'exiftool',
          [
            '-overwrite_original', '-P', '-charset', 'filename=utf8', ...args,
            ...batch.map((p) => path.join(ROOT, p.rel_path)),
          ],
          { maxBuffer: 16 * 1024 * 1024 },
        );
      } catch (e) {
        fileErrors.push({
          files: batch.length,
          message: String(e.stderr || e.message).split('\n')[0],
        });
      }
      for (const p of batch) {
        try {
          const st = await fs.stat(path.join(ROOT, p.rel_path));
          await pool.query('UPDATE photos SET file_size = ? WHERE id = ?', [st.size, p.id]);
        } catch {
          // Datei fehlt: Größe bleibt unverändert
        }
      }
    }
    res.json({ updated: photos.length, fileErrors });
  });

  return router;
}
