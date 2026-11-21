import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { pool } from './db.js';

const ROOT = path.resolve(process.env.PHOTO_ROOT);
const THUMB_DIR = path.resolve(process.env.THUMB_DIR);
const SIZES = [400, 1600];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/tags', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.id AS gid, g.name AS gname, t.id AS tid, t.name AS tname, t.legacy, COUNT(pt.photo_id) AS n
     FROM tag_groups g
     JOIN tags t ON t.group_id = g.id
     LEFT JOIN photo_tags pt ON pt.tag_id = t.id
     WHERE g.visible = 1 AND t.active = 1
     GROUP BY t.id
     ORDER BY g.sort, g.id, t.name`,
  );
  const groups = new Map();
  for (const r of rows) {
    if (r.legacy && r.n === 0) continue;
    if (!groups.has(r.gid)) groups.set(r.gid, { id: r.gid, name: r.gname, tags: [] });
    groups.get(r.gid).tags.push({ id: r.tid, name: r.tname, count: Number(r.n), legacy: !!r.legacy });
  }
  res.json([...groups.values()]);
});

app.get('/api/photos', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 60, 1), 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const where = [];
  const params = [];

  const minRating = parseInt(req.query.rating);
  if (minRating >= 1 && minRating <= 5) {
    where.push('p.rating >= ?');
    params.push(minRating);
  }
  const minWidth = parseInt(req.query.minWidth) || 0;
  if (minWidth > 0) {
    where.push('p.width >= ?');
    params.push(minWidth);
  }
  if (DATE_RE.test(req.query.from ?? '')) {
    where.push('p.taken_at >= ?');
    params.push(`${req.query.from} 00:00:00`);
  }
  if (DATE_RE.test(req.query.to ?? '')) {
    where.push('p.taken_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(req.query.to);
  }
  const tagIds = String(req.query.tags ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (tagIds.length) {
    const [trs] = await pool.query('SELECT id, group_id FROM tags WHERE id IN (?)', [tagIds]);
    const byGroup = new Map();
    for (const t of trs) {
      if (!byGroup.has(t.group_id)) byGroup.set(t.group_id, []);
      byGroup.get(t.group_id).push(t.id);
    }
    for (const ids of byGroup.values()) {
      where.push('EXISTS (SELECT 1 FROM photo_tags x WHERE x.photo_id = p.id AND x.tag_id IN (?))');
      params.push(ids);
    }
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ n: total }]] = await pool.query(`SELECT COUNT(*) AS n FROM photos p ${w}`, params);
  const [photos] = await pool.query(
    `SELECT p.id, p.file_name, p.taken_at, p.date_source, p.date_precision, p.rating, p.width, p.height
     FROM photos p ${w}
     ORDER BY p.taken_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  if (photos.length) {
    const [trs] = await pool.query(
      `SELECT pt.photo_id, t.id, t.name, g.name AS grp
       FROM photo_tags pt
       JOIN tags t ON t.id = pt.tag_id
       JOIN tag_groups g ON g.id = t.group_id
       WHERE pt.photo_id IN (?)`,
      [photos.map((p) => p.id)],
    );
    const map = new Map();
    for (const t of trs) {
      if (!map.has(t.photo_id)) map.set(t.photo_id, []);
      map.get(t.photo_id).push({ id: t.id, name: t.name, group: t.grp });
    }
    for (const p of photos) p.tags = map.get(p.id) ?? [];
  }
  res.json({ total, photos });
});

app.get('/api/photos/:id/thumb', async (req, res) => {
  const size = SIZES.includes(Number(req.query.size)) ? Number(req.query.size) : 400;
  const id = parseInt(req.params.id);
  const [[p]] = await pool.query('SELECT rel_path FROM photos WHERE id = ?', [id]);
  if (!p) return res.sendStatus(404);
  const src = path.resolve(ROOT, p.rel_path);
  if (!src.startsWith(ROOT + path.sep)) return res.sendStatus(400);
  const out = path.join(THUMB_DIR, String(size), `${id}.jpg`);
  try {
    await fs.access(out);
  } catch {
    await fs.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.${Math.random().toString(36).slice(2)}.tmp`;
    await sharp(src).rotate().resize({ width: size, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(tmp);
    await fs.rename(tmp, out);
  }
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(out);
});

app.listen(3000, '127.0.0.1', () => console.log('API auf Port 3000'));
