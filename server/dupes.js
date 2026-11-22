import express from 'express'

export function makeDupesRouter(pool) {
  const router = express.Router()

  router.get('/', async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
    const [rows] = await pool.query(
      `SELECT d.group_key, p.id, p.rel_path, p.width, p.height, p.file_size, p.taken_at, p.rating
       FROM duplicates d JOIN photos p ON p.rel_path = d.rel_path
       ORDER BY d.group_key, p.rel_path`,
    )
    const groups = new Map()
    for (const r of rows) {
      if (!groups.has(r.group_key)) groups.set(r.group_key, [])
      groups.get(r.group_key).push({ ...r, tags: [] })
    }
    const all = [...groups.entries()].filter(([, photos]) => photos.length > 1)
    const page = all.slice(offset, offset + limit)
    const byId = new Map()
    for (const [, photos] of page) for (const p of photos) byId.set(p.id, p)
    if (byId.size) {
      const [tags] = await pool.query(
        `SELECT pt.photo_id, t.name FROM photo_tags pt JOIN tags t ON t.id = pt.tag_id
         WHERE pt.photo_id IN (?) ORDER BY t.name`,
        [[...byId.keys()]],
      )
      for (const t of tags) byId.get(t.photo_id).tags.push(t.name)
    }
    res.json({
      total: all.length,
      groups: page.map(([key, photos]) => ({ key, photos })),
    })
  })

  return router
}
