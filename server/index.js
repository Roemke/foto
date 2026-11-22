import { makeDupesRouter } from './dupes.js';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ZipArchive } from 'archiver';
import { pool } from './db.js';
import { makeUploadRouter } from './upload.js';
import { makeEditRouter } from './edit.js';
import { makeAdminRouter } from './admin.js';
import { makeTrashRouter } from './trash.js';
import { makeAuth, sessionMiddleware } from './auth.js';
import { makeUsersRouter } from './users.js';
import { makeSyncRouter } from './sync-route.js';

const ROOT = path.resolve(process.env.PHOTO_ROOT);
const THUMB_DIR = path.resolve(process.env.THUMB_DIR);
const SIZES = [400, 1600];
const MAX_ZIP = Number(process.env.MAX_ZIP) || 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = new Set([
  'januar', 'februar', 'märz', 'maerz', 'april', 'mai', 'juni', 'juli',
  'august', 'september', 'oktober', 'november', 'dezember',
]);

function sanitize(s) {
  return s.replace(/[:/\\?*"<>|]/g, '').trim().replace(/\s+/g, '_');
}

function anlassFrom(relPath) {
  const dir = path.basename(path.dirname(relPath));
  if (!dir || dir === '.') return '';
  const rest = dir.replace(/^\s*(?:\d{4}[._-]\d{2}(?:[._-]\d{2})?|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{8})[\s_-]*/, '');
  const s = sanitize(rest);
  if (!s || /^\d{4}$/.test(s) || MONTHS.has(s.toLowerCase())) return '';
  return s;
}

async function downloadName(row) {
  if (/^\d{4}-\d{2}-\d{2}-/.test(row.file_name)) return row.file_name;
  const base = sanitize(path.basename(row.file_name, path.extname(row.file_name)));
  if (!row.taken_at) return `${base}.jpg`;
  const anlass = anlassFrom(row.rel_path) || base;
  const [d, t] = row.taken_at.split(' ');
  let datePart = d;
  if (row.date_precision === 'month') datePart = d.slice(0, 7);
  if (row.date_precision === 'year') datePart = d.slice(0, 4);
  if (row.date_source === 'exif') {
    const [h, mi, s] = t.split(':');
    return `${datePart}-${h}h${mi}m${s}s-${anlass}.jpg`;
  }
  const dir = path.dirname(row.rel_path);
  const prefix = dir === '.' ? '' : dir.replace(/[\\%_]/g, '\\$&') + '/';
  const [[r]] = await pool.query(
    'SELECT COUNT(*) AS n FROM photos WHERE rel_path LIKE ? AND rel_path NOT LIKE ? AND file_name < ?',
    [`${prefix}%`, `${prefix}%/%`, row.file_name],
  );
  return `${datePart}-${anlass}-${String(Number(r.n) + 1).padStart(3, '0')}.jpg`;
}

const app = express();

app.set('trust proxy', 1);
app.use(sessionMiddleware);
const { router: authRouter, requireLogin, requireAdmin } = makeAuth(pool);
app.use('/api/auth', authRouter);
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', requireLogin);
app.use('/api/upload', makeUploadRouter(pool));
app.use('/api/edit', requireAdmin, makeEditRouter(pool));
app.use('/api/admin', requireAdmin, makeAdminRouter(pool));
app.use('/api/trash', requireAdmin, makeTrashRouter(pool));
app.use('/api/users', requireAdmin, makeUsersRouter(pool));
app.use('/api/sync', requireAdmin, makeSyncRouter(pool));
app.use('/api/duplicates', requireAdmin, makeDupesRouter(pool));


function searchParts(qs) {
  const where = [];
  const params = [];
  const pad = (n) => String(n).padStart(2, '0');
  const words = String(qs ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const w0 of words) {
    const w = w0.slice(0, 60);
    const like = `%${w.replace(/[\\%_]/g, '\\$&')}%`;
    const or = [
      'p.rel_path LIKE ?',
      'p.photographer LIKE ?',
      'EXISTS (SELECT 1 FROM photo_tags sx JOIN tags st ON st.id = sx.tag_id WHERE sx.photo_id = p.id AND st.active = 1 AND st.name LIKE ?)',
    ];
    const ps = [like, like, like];
    let m;
    if ((m = w.match(/^(\d{4})$/))) {
      or.push('YEAR(p.taken_at) = ?');
      ps.push(Number(m[1]));
    } else if ((m = w.match(/^(\d{4})-(\d{1,2})$/))) {
      or.push('(YEAR(p.taken_at) = ? AND MONTH(p.taken_at) = ?)');
      ps.push(Number(m[1]), Number(m[2]));
    } else if ((m = w.match(/^(\d{1,2})\.(\d{4})$/))) {
      or.push('(YEAR(p.taken_at) = ? AND MONTH(p.taken_at) = ?)');
      ps.push(Number(m[2]), Number(m[1]));
    } else if ((m = w.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) {
      or.push('DATE(p.taken_at) = ?');
      ps.push(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
    }
    where.push(`(${or.join(' OR ')})`);
    params.push(...ps);
  }
  return { where, params };
}

function filterParts(q) {
  const where = [];
  const params = [];
  const minRating = parseInt(q.rating);
  if (minRating >= 1 && minRating <= 5) {
    where.push('p.rating >= ?');
    params.push(minRating);
  }
  const minWidth = parseInt(q.minWidth) || 0;
  if (minWidth > 0) {
    where.push('p.width >= ?');
    params.push(minWidth);
  }
  if (DATE_RE.test(q.from ?? '')) {
    where.push('p.taken_at >= ?');
    params.push(`${q.from} 00:00:00`);
  }
  if (DATE_RE.test(q.to ?? '')) {
    where.push('p.taken_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(q.to);
  }
  const sq = searchParts(q.q);
  where.push(...sq.where);
  params.push(...sq.params);
  return { where, params };
}

app.get('/api/tags', async (req, res) => {
  const { where, params } = filterParts(req.query);
  const cond = where.length ? ` AND ${where.join(' AND ')}` : '';
  const selected = new Set(
    String(req.query.tags ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  );

  const [meta] = await pool.query(
    `SELECT g.id AS gid, g.name AS gname, t.id AS tid, t.name AS tname, t.legacy
     FROM tag_groups g JOIN tags t ON t.group_id = g.id
     WHERE g.visible = 1 AND t.active = 1
     ORDER BY g.sort, g.id, t.name`,
  );
  const selByGroup = new Map();
  for (const m of meta) {
    if (!selected.has(m.tid)) continue;
    if (!selByGroup.has(m.gid)) selByGroup.set(m.gid, []);
    selByGroup.get(m.gid).push(m.tid);
  }

  const gids = [...new Set(meta.map((m) => m.gid))];
  const counts = new Map();
  await Promise.all(
    gids.map(async (gid) => {
      const others = [...selByGroup.entries()].filter(([g]) => g !== gid).map(([, ids]) => ids);
      const extra = others
        .map(() => ' AND EXISTS (SELECT 1 FROM photo_tags x WHERE x.photo_id = p.id AND x.tag_id IN (?))')
        .join('');
      const [rows] = await pool.query(
        `SELECT t.id, COUNT(p.id) AS n
         FROM tags t
         LEFT JOIN photo_tags pt ON pt.tag_id = t.id
         LEFT JOIN photos p ON p.id = pt.photo_id${cond}${extra}
         WHERE t.group_id = ? AND t.active = 1
         GROUP BY t.id`,
        [...params, ...others, gid],
      );
      for (const r of rows) counts.set(r.id, Number(r.n));
    }),
  );

  const groups = new Map();
  for (const m of meta) {
    const n = counts.get(m.tid) ?? 0;
    if (m.legacy && n === 0 && !selected.has(m.tid)) continue;
    if (!groups.has(m.gid)) groups.set(m.gid, { id: m.gid, name: m.gname, tags: [] });
    groups.get(m.gid).tags.push({ id: m.tid, name: m.tname, count: n, legacy: !!m.legacy });
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
  const sq = searchParts(req.query.q);
  where.push(...sq.where);
  params.push(...sq.params);
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
  const [[p]] = await pool.query('SELECT rel_path, file_name, taken_at, date_source, date_precision FROM photos WHERE id = ?', [id]);
  if (!p) return res.sendStatus(404);
  const src = path.resolve(ROOT, p.rel_path);
  if (!src.startsWith(ROOT + path.sep)) return res.sendStatus(400);
  const out = path.join(THUMB_DIR, String(size), `${id}.jpg`);
  try {
    await fs.access(out);
  } catch {
    await fs.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.${Math.random().toString(36).slice(2)}.tmp`;
    await sharp(src).rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(tmp);
    await fs.rename(tmp, out);
  }
  const enc = encodeURIComponent(await downloadName(p)).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  res.set('Content-Disposition', `inline; filename*=UTF-8''${enc}`);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(out);
});

app.get('/api/photos/:id', async (req, res) => {
  const [[p]] = await pool.query(
    `SELECT id, rel_path, file_name, width, height, file_size, taken_at, date_source, date_precision, rating, photographer
     FROM photos WHERE id = ?`,
    [parseInt(req.params.id)],
  );
  if (!p) return res.sendStatus(404);
  res.json(p);
});

app.get('/api/photos/:id/original', async (req, res) => {
  const [[p]] = await pool.query(
    'SELECT rel_path, file_name, taken_at, date_source, date_precision FROM photos WHERE id = ?',
    [parseInt(req.params.id)],
  );
  if (!p) return res.sendStatus(404);
  const src = path.resolve(ROOT, p.rel_path);
  if (!src.startsWith(ROOT + path.sep)) return res.sendStatus(400);
  res.download(src, await downloadName(p), { dotfiles: 'allow' });
});

app.post('/api/download', express.urlencoded({ extended: false, limit: '1mb' }), async (req, res) => {
  const ids = String(req.body?.ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.sendStatus(400);
  if (ids.length > MAX_ZIP) return res.status(413).send(`Maximal ${MAX_ZIP} Fotos pro ZIP-Datei.`);

  const [rows] = await pool.query(
    `SELECT id, rel_path, file_name, taken_at, date_source, date_precision
     FROM photos WHERE id IN (?) ORDER BY taken_at, id`,
    [ids],
  );
  const today = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="Schulfotos-${today}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 0 } });
  archive.on('warning', (e) => console.warn('ZIP:', e.message));
  archive.on('error', (e) => {
    console.error('ZIP:', e);
    res.destroy(e);
  });
  archive.pipe(res);

  const used = new Set();
  for (const row of rows) {
    const src = path.resolve(ROOT, row.rel_path);
    if (!src.startsWith(ROOT + path.sep)) continue;
    const name = await downloadName(row);
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let cand = name;
    let k = 0;
    while (used.has(cand.toLowerCase())) {
      k++;
      cand = `${stem}-${k}${ext}`;
    }
    used.add(cand.toLowerCase());
    archive.file(src, { name: cand });
  }
  await archive.finalize();
});

const WEB_DIST = path.resolve(process.env.WEB_DIST || '../web/dist');
app.use(express.static(WEB_DIST));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => err && next());
});

app.listen(3000, '127.0.0.1', () => console.log('API auf Port 3000'));
