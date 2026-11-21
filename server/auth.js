import * as client from 'openid-client'
import session from 'express-session'
import { Router } from 'express'

const env = process.env
const domain = '@' + (env.ALLOWED_DOMAIN || '').toLowerCase()
const initialAdmins = new Set(
  (env.INITIAL_ADMINS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

let config
async function getConfig() {
  config ??= await client.discovery(
    new URL(env.OIDC_ISSUER),
    env.OIDC_CLIENT_ID,
    env.OIDC_CLIENT_SECRET,
  )
  return config
}

export const sessionMiddleware = session({
  name: 'fotos.sid',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 8 * 3600 * 1000 },
})

export function makeAuth(pool) {
  const router = Router()

  async function loadUser(email) {
    if (!email) return null
    const [rows] = await pool.query('SELECT email, name, role FROM users WHERE email = ?', [email])
    return rows[0] || null
  }

  router.get('/login', async (req, res) => {
    try {
      const cfg = await getConfig()
      const verifier = client.randomPKCECodeVerifier()
      const state = client.randomState()
      const nonce = client.randomNonce()
      req.session.oidc = { verifier, state, nonce }
      const url = client.buildAuthorizationUrl(cfg, {
        redirect_uri: env.OIDC_REDIRECT_URI,
        scope: 'openid profile email',
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      })
      req.session.save(() => res.redirect(url.href))
    } catch (e) {
      console.error('login', e)
      res.status(500).send('Anmeldung nicht verfügbar')
    }
  })

  router.get('/callback', async (req, res) => {
    const saved = req.session.oidc
    try {
      if (!saved) throw new Error('keine Anmeldung gestartet')
      const cfg = await getConfig()
      const current = new URL(req.originalUrl, env.OIDC_REDIRECT_URI)
      const tokens = await client.authorizationCodeGrant(cfg, current, {
        pkceCodeVerifier: saved.verifier,
        expectedState: saved.state,
        expectedNonce: saved.nonce,
        idTokenExpected: true,
      })
      const c = tokens.claims()
      const email = String(c.email || c.preferred_username || '').toLowerCase()
      if (!email.endsWith(domain) || email.split('@').length !== 2) {
        console.warn('Login abgelehnt:', email)
        return req.session.destroy(() => res.redirect('/?login=denied'))
      }
      const admin = initialAdmins.has(email)
      await pool.query(
        `INSERT INTO users (email, name, role, last_login) VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE name = VALUES(name), last_login = NOW(),
         role = IF(?, 'admin', role)`,
        [email, c.name || null, admin ? 'admin' : 'user', admin],
      )
      req.session.regenerate((err) => {
        if (err) throw err
        req.session.email = email
        req.session.save(() => res.redirect('/'))
      })
    } catch (e) {
      console.error('callback', e)
      res.redirect('/?login=failed')
    }
  })

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }))
  })

  router.get('/me', async (req, res) => {
    const u = await loadUser(req.session?.email)
    if (!u) return res.status(401).json({ error: 'nicht angemeldet' })
    res.json(u)
  })

  async function requireLogin(req, res, next) {
    try {
      const u = await loadUser(req.session?.email)
      if (!u) return res.status(401).json({ error: 'nicht angemeldet' })
      req.user = u
      next()
    } catch (e) {
      next(e)
    }
  }

  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'keine Berechtigung' })
    next()
  }

  return { router, requireLogin, requireAdmin }
}
