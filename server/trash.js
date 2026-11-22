import express from 'express';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { indexFiles } from './indexfile.js';
import { scanNextcloud } from './ncscan.js';

const ROOT = process.env.PHOTO_ROOT;
const TRASH = process.env.TRASH_DIR;

const idsOf = (v) =>
  (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);

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

export function makeTrashRouter(pool) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.post('/', async (req, res) => {
    if (!TRASH) return res.status(500).json({ error: 'TRASH_DIR ist nicht gesetzt' });
    const ids = idsOf(req.body.ids);
    if (!ids.length || ids.length > 500) {
      return res.status(400).json({ error: 'Ungültige Auswahl (1 bis 500 Fotos)' });
    }
    const [photos] = await pool.query('SELECT id, rel_path FROM photos WHERE id IN (?)', [ids]);
    const failed = [];
    let moved = 0;
    const movedRels = [];
    for (const p of photos) {
      try {
        const dest = await freeName(path.join(TRASH, p.rel_path));
        await moveFile(path.join(ROOT, p.rel_path), dest);
        await pool.query('INSERT INTO trash (orig_rel_path, trash_rel_path) VALUES (?, ?)', [
          p.rel_path,
          path.relative(TRASH, dest),
        ]);
        await pool.query('DELETE FROM photos WHERE id = ?', [p.id]);
        moved++;
        movedRels.push(p.rel_path);
      } catch (e) {
        failed.push({ id: p.id, rel_path: p.rel_path, error: e.message });
      }
    }
    scanNextcloud(movedRels);
    res.json({ moved, failed });
  });

  router.get('/', async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, orig_rel_path, trashed_at FROM trash ORDER BY trashed_at DESC, id DESC LIMIT 1000',
    );
    res.json(rows);
  });

  router.get('/:id/thumb', async (req, res) => {
    const [rows] = await pool.query('SELECT trash_rel_path FROM trash WHERE id = ?', [
      Number(req.params.id),
    ]);
    if (!rows.length) return res.sendStatus(404);
    const buf = await sharp(path.join(TRASH, rows[0].trash_rel_path))
      .rotate()
      .resize({ width: 300, height: 300, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    res.type('jpeg').send(buf);
  });

  router.post('/restore', async (req, res) => {
    const ids = idsOf(req.body.ids);
    if (!ids.length || ids.length > 500) {
      return res.status(400).json({ error: 'Ungültige Auswahl (1 bis 500 Fotos)' });
    }
    const [rows] = await pool.query(
      'SELECT id, orig_rel_path, trash_rel_path FROM trash WHERE id IN (?)',
      [ids],
    );
    const failed = [];
    const restored = [];
    for (const r of rows) {
      try {
        const dest = await freeName(path.join(ROOT, r.orig_rel_path));
        await moveFile(path.join(TRASH, r.trash_rel_path), dest);
        restored.push({ trashId: r.id, rel: path.relative(ROOT, dest) });
      } catch (e) {
        failed.push({ id: r.id, error: e.message });
      }
    }
    for (let i = 0; i < restored.length; i += 100) {
      const batch = restored.slice(i, i + 100);
      const results = await indexFiles(pool, batch.map((b) => b.rel));
      for (const [k, x] of results.entries()) {
        if (x.error) {
          failed.push({ id: batch[k].trashId, error: 'Zurückgelegt, aber nicht eingelesen: ' + x.error });
        }
        await pool.query('DELETE FROM trash WHERE id = ?', [batch[k].trashId]);
      }
    }
    scanNextcloud(restored.map((r) => r.rel));
    res.json({ restored: restored.length, failed });
  });

  router.post('/purge', async (req, res) => {
    let rows;
    if (req.body.all) {
      [rows] = await pool.query('SELECT id, trash_rel_path FROM trash');
    } else {
      const ids = idsOf(req.body.ids);
      if (!ids.length) return res.status(400).json({ error: 'Keine Auswahl' });
      [rows] = await pool.query('SELECT id, trash_rel_path FROM trash WHERE id IN (?)', [ids]);
    }
    let purged = 0;
    const failed = [];
    for (const r of rows) {
      try {
        await fs.rm(path.join(TRASH, r.trash_rel_path), { force: true });
        await pool.query('DELETE FROM trash WHERE id = ?', [r.id]);
        purged++;
      } catch (e) {
        failed.push({ id: r.id, error: e.message });
      }
    }
    res.json({ purged, failed });
  });

  return router;
}
