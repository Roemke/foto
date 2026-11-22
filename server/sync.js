import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { indexFiles } from './indexfile.js'

const run = promisify(execFile)
const ROOT = path.resolve(process.env.PHOTO_ROOT)
const THUMB_DIR = path.resolve(process.env.THUMB_DIR)
const SIZES = [400, 1600]
const BATCH = 50
const JPEG = /\.jpe?g$/i

let running = false
export const isSyncRunning = () => running

async function walk(dir, rel, out, state) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (e) {
    if (rel === '') throw e
    state.complete = false
    console.error('sync: Ordner nicht lesbar', dir, e.message)
    return
  }
  const files = []
  for (const d of entries) {
    if (d.name.startsWith('.')) continue
    const r = rel ? `${rel}/${d.name}` : d.name
    if (d.isDirectory()) await walk(path.join(dir, d.name), r, out, state)
    else if (d.isFile() && JPEG.test(d.name)) files.push(r)
  }
  await Promise.all(
    files.map(async (r) => {
      try {
        const st = await fs.stat(path.join(ROOT, r))
        out.set(r, { size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        state.complete = false
      }
    }),
  )
}

async function dropThumbs(ids) {
  for (const id of ids)
    for (const s of SIZES)
      await fs.rm(path.join(THUMB_DIR, String(s), `${id}.jpg`), { force: true })
}

async function findDuplicates(pool, added, disk) {
  const dups = []
  const bySize = new Map()
  for (const rel of added) {
    const size = disk.get(rel).size
    if (!bySize.has(size)) bySize.set(size, [])
    bySize.get(size).push(rel)
  }
  const sizes = [...bySize.keys()]
  const existing = new Map()
  for (let i = 0; i < sizes.length; i += 1000) {
    const [rows] = await pool.query(
      'SELECT file_size, rel_path FROM photos WHERE file_size IN (?)',
      [sizes.slice(i, i + 1000)],
    )
    for (const r of rows) {
      const size = Number(r.file_size)
      if (!existing.has(size)) existing.set(size, [])
      existing.get(size).push(r.rel_path)
    }
  }
  for (const [size, rels] of bySize) {
    const known = existing.get(size) ?? []
    if (!known.length && rels.length < 2) continue
    const cands = [...known, ...rels]
    const cache = new Map()
    const read = async (r) => {
      if (!cache.has(r)) cache.set(r, await fs.readFile(path.join(ROOT, r)))
      return cache.get(r)
    }
    try {
      for (let j = known.length; j < cands.length; j++) {
        const a = await read(cands[j])
        for (let i = 0; i < j; i++) {
          if (a.equals(await read(cands[i]))) {
            dups.push({ rel: cands[j], sameAs: cands[i] })
            break
          }
        }
      }
    } catch (e) {
      console.error('sync: Dublettenprüfung übersprungen', size, e.message)
    }
  }
  return dups
}

export async function syncArchive(pool, { dryRun = false, force = false } = {}) {
  if (running) throw new Error('Abgleich läuft bereits')
  running = true
  try {
    const t0 = Date.now()
    const disk = new Map()
    const state = { complete: true }
    await walk(ROOT, '', disk, state)
    const [rows] = await pool.query('SELECT id, rel_path, file_size, file_mtime FROM photos')
    const known = new Set(rows.map((r) => r.rel_path))
    const gone = []
    const changed = []
    for (const r of rows) {
      const f = disk.get(r.rel_path)
      if (!f) {
        gone.push(r)
        continue
      }
      const dm = r.file_mtime ? Math.abs(new Date(r.file_mtime).getTime() - f.mtimeMs) : Infinity
      if (Number(r.file_size) !== f.size || dm > 2000) changed.push(r)
    }
    const added = [...disk.keys()].filter((k) => !known.has(k))
    const res = {
      onDisk: disk.size,
      inDb: rows.length,
      added: added.length,
      changed: changed.length,
      gone: gone.length,
      removed: 0,
      errors: [],
      notes: [],
    }
    const dups = await findDuplicates(pool, added, disk)
    res.duplicates = dups.length
    res.duplicateList = dups.slice(0, 200)
    let removeOk = state.complete
    if (!state.complete) res.notes.push('Ordner nicht lesbar: nichts wird entfernt')
    if (disk.size === 0 && rows.length > 0) {
      removeOk = false
      res.notes.push('Archiv wirkt leer (Freigabe nicht eingebunden?): nichts wird entfernt')
    }
    const limit = Math.max(50, Math.floor(rows.length * 0.1))
    if (gone.length > limit && !force) {
      removeOk = false
      res.notes.push(`${gone.length} Dateien fehlen (Grenze ${limit}): nichts wird entfernt, ggf. --force`)
    }
    if (dryRun) {
      res.sample = {
        added: added.slice(0, 10),
        changed: changed.slice(0, 10).map((r) => r.rel_path),
        gone: gone.slice(0, 10).map((r) => r.rel_path),
      }
      return res
    }
    for (let i = 0; i < added.length; i += BATCH) {
      for (const x of await indexFiles(pool, added.slice(i, i + BATCH)))
        if (x.error) res.errors.push(x)
    }
    await dropThumbs(changed.map((r) => r.id))
    const paths = changed.map((r) => r.rel_path)
    for (let i = 0; i < paths.length; i += BATCH) {
      for (const x of await indexFiles(pool, paths.slice(i, i + BATCH), { refresh: true }))
        if (x.error) res.errors.push(x)
    }
    if (removeOk && gone.length) {
      const ids = gone.map((r) => r.id)
      for (let i = 0; i < ids.length; i += 500)
        await pool.query('DELETE FROM photos WHERE id IN (?)', [ids.slice(i, i + 500)])
      await dropThumbs(ids)
      res.removed = ids.length
    }
    const cmd = process.env.NEXTCLOUD_SCAN_CMD
    if (cmd) {
      try {
        await run('sh', ['-c', cmd], { timeout: 3600_000 })
        res.nextcloud = 'ok'
      } catch (e) {
        res.nextcloud = 'Fehler: ' + e.message
      }
    } else res.nextcloud = 'nicht konfiguriert'
    res.seconds = Math.round((Date.now() - t0) / 1000)
    return res
  } finally {
    running = false
  }
}
