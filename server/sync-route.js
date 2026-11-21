import { Router } from 'express'
import { syncArchive, isSyncRunning } from './sync.js'

export function makeSyncRouter(pool) {
  const r = Router()
  let last = null

  r.get('/', (req, res) => res.json({ running: isSyncRunning(), last }))

  r.post('/', (req, res) => {
    if (isSyncRunning()) return res.status(409).json({ error: 'Abgleich läuft bereits' })
    const started = new Date()
    syncArchive(pool, { dryRun: req.query.dry === '1' })
      .then((result) => (last = { started, finished: new Date(), result }))
      .catch((e) => (last = { started, finished: new Date(), error: e.message }))
    res.json({ ok: true })
  })

  return r
}
