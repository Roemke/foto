import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadTagCache, parseKeywords, linkTags } from './tags.js';
import { fromExif, fromName, mk } from './dates.js';

const run = promisify(execFile);
const ROOT = process.env.PHOTO_ROOT;
const TMP = path.resolve(process.env.UPLOAD_TMP || path.join(os.tmpdir(), 'schulfotos-upload'));
const MAX_FILES = Number(process.env.MAX_UPLOAD || 500);
const MAX_BYTES = 500 * 1024 * 1024;
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const FIELDS = [
  '-Rating', '-DateTimeOriginal', '-CreateDate', '-ImageWidth', '-ImageHeight',
  '-HierarchicalSubject', '-Subject', '-Keywords',
];
const INSERT_SQL = `INSERT INTO photos
  (rel_path, file_name, width, height, file_size, file_mtime, taken_at, date_source, date_precision, rating, photographer, orig_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const upload = multer({ dest: TMP, limits: { files: MAX_FILES, fileSize: MAX_BYTES } });
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function findDuplicate(pool, buf, hash) {
  const [byHash] = await pool.query('SELECT rel_path FROM photos WHERE orig_hash = ? LIMIT 1', [hash]);
  if (byHash.length) return byHash[0].rel_path;
  const [cand] = await pool.query('SELECT rel_path FROM photos WHERE file_size = ?', [buf.length]);
  for (const c of cand) {
    try {
      if (buf.equals(await fs.readFile(path.join(ROOT, c.rel_path)))) return c.rel_path;
    } catch {
      // Datei fehlt oder ist nicht lesbar: ignorieren
    }
  }
  return null;
}

function cleanAnlass(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .slice(0, 80);
}

async function readMeta(files) {
  const map = new Map();
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    let out;
    try {
      ({ stdout: out } = await run(
        'exiftool',
        ['-json', '-charset', 'iptc=MacRoman', ...FIELDS, ...batch],
        { maxBuffer: 64 * 1024 * 1024 },
      ));
    } catch (e) {
      out = e.stdout;
    }
    for (const it of JSON.parse(out || '[]')) map.set(path.resolve(it.SourceFile), it);
  }
  return map;
}

export function makeUploadRouter(pool) {
  const router = express.Router();

  router.post('/', upload.array('files'), async (req, res) => {
    const cleanup = (req.files ?? []).map((f) => path.resolve(f.path));
    try {
      const anlassText = String(req.body.anlass ?? '').trim().slice(0, 100);
      const anlass = cleanAnlass(anlassText);
      if (!anlass) return res.status(400).json({ error: 'Anlass fehlt' });
      const photographer = String(req.body.photographer ?? '').trim().slice(0, 100) || null;

      let fallback = null;
      if (req.body.date) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.body.date));
        fallback = m && mk(m[1], m[2], m[3]);
        if (!fallback) return res.status(400).json({ error: 'Datum ungültig' });
      }
      const tagIds = String(req.body.tags ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
      const wantEvent = ['1', 'true', 'on'].includes(String(req.body.eventTag ?? ''));

      const inputs = [];
      const skipped = [];
      for (const f of req.files ?? []) {
        const tmp = path.resolve(f.path);
        if (/\.zip$/i.test(f.originalname)) {
          try {
            const zip = new AdmZip(tmp);
            for (const e of zip.getEntries()) {
              if (e.isDirectory) continue;
              const base = path.basename(e.entryName.replace(/\\/g, '/'));
              if (base.startsWith('._') || e.entryName.includes('__MACOSX')) continue;
              if (!/\.jpe?g$/i.test(base)) {
                skipped.push({ name: base, error: 'kein JPEG' });
                continue;
              }
              if (inputs.length >= MAX_FILES || e.header.size > MAX_BYTES) {
                skipped.push({ name: base, error: 'zu viele oder zu große Dateien' });
                continue;
              }
              const t = path.join(TMP, `${randomUUID()}.jpg`);
              await fs.writeFile(t, e.getData());
              cleanup.push(t);
              inputs.push({ tmp: t, name: base });
            }
          } catch {
            skipped.push({ name: f.originalname, error: 'ZIP nicht lesbar' });
          }
        } else if (/\.jpe?g$/i.test(f.originalname)) {
          inputs.push({ tmp, name: f.originalname });
        } else {
          skipped.push({ name: f.originalname, error: 'kein JPEG (HEIC folgt)' });
        }
      }
      if (!inputs.length) {
        return res.status(400).json({ error: 'Keine JPEG-Fotos erhalten', files: skipped });
      }

      const tagInfo = [];
      if (tagIds.length) {
        const [rows] = await pool.query(
          `SELECT t.id, t.name, g.name AS gname
           FROM tags t JOIN tag_groups g ON g.id = t.group_id WHERE t.id IN (?)`,
          [tagIds],
        );
        tagInfo.push(...rows);
      }
      if (wantEvent) {
        const [g] = await pool.query(
          "SELECT id, name FROM tag_groups WHERE name IN ('Event', 'Events') LIMIT 1",
        );
        if (!g.length) return res.status(400).json({ error: 'Tag-Gruppe „Event“ nicht gefunden' });
        const [r] = await pool.query(
          'INSERT INTO tags (group_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
          [g[0].id, anlassText],
        );
        if (!tagInfo.some((t) => t.id === r.insertId)) {
          tagInfo.push({ id: r.insertId, name: anlassText, gname: g[0].name });
        }
      }

      const meta = await readMeta(inputs.map((i) => i.tmp));
      const tagCache = await loadTagCache(pool);

      async function storeOne(inp) {
        const it = meta.get(inp.tmp) ?? {};
        const buf = await fs.readFile(inp.tmp);
        const hash = createHash('sha256').update(buf).digest('hex');
        const dup = await findDuplicate(pool, buf, hash);
        if (dup) return { name: inp.name, duplicate: dup };
        let taken = fromExif(it.DateTimeOriginal) ?? fromExif(it.CreateDate);
        let src = taken ? 'exif' : null;
        if (!taken) {
          taken = fromName(inp.name);
          if (taken) src = 'filename';
        }
        if (!taken && fallback) {
          taken = fallback;
          src = 'manual';
        }
        if (!taken) throw new Error('Kein Datum erkennbar – bitte „Datum für alle“ angeben');

        const date = taken.slice(0, 10);
        const [y, mo] = date.split('-');
        const hasTime = src === 'exif' || (src === 'filename' && !taken.endsWith('00:00:00'));
        const hms = taken.slice(11).split(':');
        const base = hasTime
          ? `${date}-${hms[0]}h${hms[1]}m${hms[2]}s-${anlass}`
          : `${date}-${anlass}`;
        const dir = path.join(ROOT, y, `${mo}-${MONTHS[Number(mo) - 1]}`);
        await fs.mkdir(dir, { recursive: true });

        let dest = null;
        for (let n = 0; n < 1000 && !dest; n++) {
          const cand = hasTime
            ? n ? `${base}-${n}` : base
            : `${base}-${String(n + 1).padStart(3, '0')}`;
          const p = path.join(dir, `${cand}.jpg`);
          try {
            await fs.copyFile(inp.tmp, p, fs.constants.COPYFILE_EXCL);
            dest = p;
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
          }
        }
        if (!dest) throw new Error('Kein freier Dateiname');

        const args = [];
        for (const t of tagInfo) {
          args.push(`-XMP-dc:Subject+=${t.name}`, `-XMP-lr:HierarchicalSubject+=${t.gname}|${t.name}`);
        }
        if (photographer) args.push(`-XMP-dc:Creator=${photographer}`);
        if (args.length) {
          try {
            await run('exiftool', [
              '-overwrite_original', '-P', '-charset', 'filename=utf8', ...args, dest,
            ]);
          } catch {
            await fs.rm(dest, { force: true });
            throw new Error('Metadaten konnten nicht geschrieben werden');
          }
        }

        const st = await fs.stat(dest);
        const rel = path.relative(ROOT, dest);
        const rating = Number(it.Rating) > 0 ? Number(it.Rating) : null;
        let id;
        try {
          const [r] = await pool.query(INSERT_SQL, [
            rel, path.basename(dest), it.ImageWidth ?? null, it.ImageHeight ?? null,
            st.size, st.mtime, taken, src, 'day', rating, photographer, hash,
          ]);
          id = r.insertId;
        } catch (e) {
          await fs.rm(dest, { force: true });
          throw e;
        }
        if (it.HierarchicalSubject != null || it.Subject != null || it.Keywords != null) {
          const entries = parseKeywords(
            list(it.HierarchicalSubject),
            it.Subject != null ? list(it.Subject) : list(it.Keywords),
          );
          await linkTags(pool, tagCache, id, entries);
        }
        if (tagInfo.length) {
          await pool.query('INSERT IGNORE INTO photo_tags (photo_id, tag_id) VALUES ?', [
            tagInfo.map((t) => [id, t.id]),
          ]);
        }
        return { name: inp.name, rel, taken, source: src };
      }

      const files = [...skipped];
      for (const inp of inputs) {
        try {
          files.push(await storeOne(inp));
        } catch (e) {
          files.push({ name: inp.name, error: e.message });
        }
      }
      res.json({
        ok: files.filter((f) => f.rel).length,
        failed: files.filter((f) => f.error).length,
        files,
      });
    } finally {
      await Promise.all(cleanup.map((p) => fs.rm(p, { force: true })));
    }
  });

  return router;
}
