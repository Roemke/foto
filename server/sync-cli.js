import { pool } from './db.js'
import { syncArchive } from './sync.js'

const dryRun = process.argv.includes('--dry')
const force = process.argv.includes('--force')
try {
  const r = await syncArchive(pool, { dryRun, force })
  console.log(JSON.stringify(r, null, 2))
  process.exitCode = r.errors?.length ? 1 : 0
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
