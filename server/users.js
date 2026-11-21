import express, { Router } from 'express'

export function makeUsersRouter(pool) {
  const r = Router()
  r.use(express.json())
  const domain = '@' + (process.env.ALLOWED_DOMAIN || '').toLowerCase()
  const okMail = (e) =>
    typeof e === 'string' && e.endsWith(domain) && e.length > domain.length && e.split('@').length === 2

  r.get('/', async (req, res) => {
    const [rows] = await pool.query(
      'SELECT email, name, role, last_login FROM users ORDER BY role DESC, email',
    )
    res.json(rows)
  })

  r.post('/', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const role = req.body?.role
    if (!okMail(email)) return res.status(400).json({ error: 'ungültige Adresse' })
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'ungültige Rolle' })
    if (email === req.user.email && role !== 'admin') {
      return res.status(400).json({ error: 'Du kannst dir die Verwalterrolle nicht selbst entziehen' })
    }
    await pool.query(
      'INSERT INTO users (email, role) VALUES (?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)',
      [email, role],
    )
    res.json({ ok: true })
  })

  return r
}
