import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = process.env.PHOTO_ROOT;
const BATCH = 50;

let job = { running: false, label: '', done: 0, total: 0, errors: [] };

const bad = (res, code, msg) => res.status(code).json({ error: msg });
const cleanName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
const isDup = (e) => e.code === 'ER_DUP_ENTRY';

function removeArgs(g, name, withFlat = true) {
  const a = [`-XMP-lr:HierarchicalSubject-=${g}|${name}`];
  if (withFlat) a.push(`-XMP-dc:Subject-=${name}`);
  return a;
}
function addArgs(g, name, withFlat = true) {
  const a = [`-XMP-lr:HierarchicalSubject+=${g}|${name}`];
  if (withFlat) a.push(`-XMP-dc:Subject+=${name}`);
  return a;
}

function startJob(pool, label, photos, steps) {
  job = { running: true, label, done: 0, total: photos.length, errors: [] };
  (async () => {
    for (let i = 0; i < photos.length; i += BATCH) {
      const batch = photos.slice(i, i + BATCH);
      const files = batch.map((p) => path.join(ROOT, p.rel_path));
      for (const args of steps) {
        try {
          await run(
            'exiftool',
            ['-overwrite_original', '-P', '-charset', 'filename=utf8', ...args, ...files],
            { maxBuffer: 16 * 1024 * 1024 },
          );
        } catch (e) {
          job.errors.push(String(e.stderr || e.message).split('\n')[0]);
        }
      }
      for (const p of batch) {
        try {
          const st = await fs.stat(path.join(ROOT, p.rel_path));
          await pool.query('UPDATE photos SET file_size = ? WHERE id = ?', [st.size, p.id]);
        } catch {
          // Datei fehlt: Größe bleibt unverändert
        }
      }
      job.done = Math.min(i + BATCH, photos.length);
    }
    job.running = false;
  })().catch((e) => {
    job.errors.push(e.message);
    job.running = false;
  });
}

export function makeAdminRouter(pool) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  const busy = (res) => {
    if (job.running) {
      bad(res, 409, 'Es läuft noch ein Dateiabgleich');
      return true;
    }
    return false;
  };
  const tagRow = async (id) => {
    const [r] = await pool.query(
      `SELECT t.id, t.name, t.group_id, g.name AS gname
       FROM tags t JOIN tag_groups g ON g.id = t.group_id WHERE t.id = ?`,
      [id],
    );
    return r[0];
  };
  const photosOf = async (tagId) => {
    const [rows] = await pool.query(
      `SELECT p.id, p.rel_path FROM photos p
       JOIN photo_tags pt ON pt.photo_id = p.id WHERE pt.tag_id = ?`,
      [tagId],
    );
    return rows;
  };

  router.get('/job', (req, res) => res.json(job));

  router.get('/tags', async (req, res) => {
    const [rows] = await pool.query(
      `SELECT g.id AS gid, g.name AS gname, g.sort, g.visible,
              t.id AS tid, t.name AS tname, t.active, t.legacy, COUNT(pt.photo_id) AS n
       FROM tag_groups g
       LEFT JOIN tags t ON t.group_id = g.id
       LEFT JOIN photo_tags pt ON pt.tag_id = t.id
       GROUP BY g.id, g.name, g.sort, g.visible, t.id, t.name, t.active, t.legacy
       ORDER BY g.sort, g.id, t.name`,
    );
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.gid)) {
        groups.set(r.gid, { id: r.gid, name: r.gname, sort: r.sort, visible: !!r.visible, tags: [] });
      }
      if (r.tid != null) {
        groups.get(r.gid).tags.push({
          id: r.tid, name: r.tname, active: !!r.active, legacy: !!r.legacy, count: Number(r.n),
        });
      }
    }
    res.json([...groups.values()]);
  });

  router.post('/groups', async (req, res) => {
    const name = cleanName(req.body.name);
    if (!name) return bad(res, 400, 'Name fehlt');
    const [[m]] = await pool.query('SELECT COALESCE(MAX(sort), 0) AS s FROM tag_groups');
    try {
      const [r] = await pool.query('INSERT INTO tag_groups (name, sort) VALUES (?, ?)', [
        name,
        Number(m.s) + 10,
      ]);
      res.json({ id: r.insertId });
    } catch (e) {
      if (isDup(e)) return bad(res, 409, 'Diese Gruppe gibt es schon');
      throw e;
    }
  });

  router.patch('/groups/:id', async (req, res) => {
    const id = Number(req.params.id);
    const sets = [];
    const vals = [];
    if (req.body.visible !== undefined) {
      sets.push('visible = ?');
      vals.push(req.body.visible ? 1 : 0);
    }
    if (req.body.sort !== undefined) {
      const s = Number(req.body.sort);
      if (!Number.isInteger(s)) return bad(res, 400, 'Sortierung ungültig');
      sets.push('sort = ?');
      vals.push(s);
    }
    if (!id || !sets.length) return bad(res, 400, 'Nichts zu ändern');
    const [r] = await pool.query(`UPDATE tag_groups SET ${sets.join(', ')} WHERE id = ?`, [
      ...vals,
      id,
    ]);
    if (!r.affectedRows) return bad(res, 404, 'Gruppe nicht gefunden');
    res.json({ ok: true });
  });

  router.delete('/groups/:id', async (req, res) => {
    const id = Number(req.params.id);
    const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM tags WHERE group_id = ?', [id]);
    if (c.n) return bad(res, 409, 'Die Gruppe enthält noch Tags');
    await pool.query('DELETE FROM tag_groups WHERE id = ?', [id]);
    res.json({ ok: true });
  });

  router.post('/tags', async (req, res) => {
    const name = cleanName(req.body.name);
    const groupId = Number(req.body.groupId);
    if (!name || !groupId) return bad(res, 400, 'Name oder Gruppe fehlt');
    try {
      const [r] = await pool.query('INSERT INTO tags (group_id, name) VALUES (?, ?)', [groupId, name]);
      res.json({ id: r.insertId });
    } catch (e) {
      if (isDup(e)) return bad(res, 409, 'Diesen Tag gibt es in der Gruppe schon');
      if (e.code === 'ER_NO_REFERENCED_ROW_2') return bad(res, 404, 'Gruppe nicht gefunden');
      throw e;
    }
  });

  router.patch('/tags/:id', async (req, res) => {
    const id = Number(req.params.id);
    const t = await tagRow(id);
    if (!t) return bad(res, 404, 'Tag nicht gefunden');
    const name = req.body.name !== undefined ? cleanName(req.body.name) : t.name;
    const groupId = req.body.groupId !== undefined ? Number(req.body.groupId) : t.group_id;
    if (!name || !groupId) return bad(res, 400, 'Name oder Gruppe ungültig');
    const moves = name !== t.name || groupId !== t.group_id;

    let g = null;
    if (moves) {
      if (busy(res)) return;
      [g] = await pool.query('SELECT id, name FROM tag_groups WHERE id = ?', [groupId]);
      if (!g.length) return bad(res, 404, 'Gruppe nicht gefunden');
      const [dup] = await pool.query(
        'SELECT id FROM tags WHERE group_id = ? AND name = ? AND id <> ?',
        [groupId, name, id],
      );
      if (dup.length) {
        return bad(res, 409, 'Diesen Tag gibt es in der Gruppe schon – bitte zusammenführen');
      }
    }
    if (req.body.active !== undefined) {
      await pool.query('UPDATE tags SET active = ? WHERE id = ?', [req.body.active ? 1 : 0, id]);
    }
    if (!moves) return res.json({ ok: true, files: 0 });

    const photos = await photosOf(id);
    await pool.query('UPDATE tags SET name = ?, group_id = ? WHERE id = ?', [name, groupId, id]);
    const flat = name !== t.name;
    if (photos.length) {
      startJob(pool, `Tag „${t.name}“ geändert`, photos, [
        removeArgs(t.gname, t.name, flat),
        addArgs(g[0].name, name, flat),
      ]);
    }
    res.json({ ok: true, files: photos.length });
  });

  router.post('/tags/:id/merge', async (req, res) => {
    const a = await tagRow(Number(req.params.id));
    const b = await tagRow(Number(req.body.into));
    if (!a || !b) return bad(res, 404, 'Tag nicht gefunden');
    if (a.id === b.id) return bad(res, 400, 'Quelle und Ziel sind gleich');
    if (busy(res)) return;
    const photos = await photosOf(a.id);
    await pool.query(
      'INSERT IGNORE INTO photo_tags (photo_id, tag_id) SELECT photo_id, ? FROM photo_tags WHERE tag_id = ?',
      [b.id, a.id],
    );
    await pool.query('DELETE FROM photo_tags WHERE tag_id = ?', [a.id]);
    await pool.query('DELETE FROM tags WHERE id = ?', [a.id]);
    if (photos.length) {
      startJob(pool, `„${a.name}“ in „${b.name}“ zusammengeführt`, photos, [
        removeArgs(a.gname, a.name),
        addArgs(b.gname, b.name),
      ]);
    }
    res.json({ ok: true, files: photos.length });
  });

  router.delete('/tags/:id', async (req, res) => {
    const t = await tagRow(Number(req.params.id));
    if (!t) return bad(res, 404, 'Tag nicht gefunden');
    if (busy(res)) return;
    const photos = await photosOf(t.id);
    await pool.query('DELETE FROM photo_tags WHERE tag_id = ?', [t.id]);
    await pool.query('DELETE FROM tags WHERE id = ?', [t.id]);
    if (photos.length) {
      startJob(pool, `Tag „${t.name}“ gelöscht`, photos, [removeArgs(t.gname, t.name)]);
    }
    res.json({ ok: true, files: photos.length });
  });

  return router;
}
