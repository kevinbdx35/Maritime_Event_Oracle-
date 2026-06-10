import { randomBytes, createHash } from 'crypto'
import { Pool } from 'pg'

const pool = new Pool({
  host: process.env['DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['DB_PORT'] ?? '5432'),
  database: process.env['DB_NAME'] ?? 'maritime',
  user: process.env['DB_USER'] ?? 'maritime',
  password: process.env['DB_PASSWORD'] ?? 'maritime_dev',
})

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error('Usage: pnpm create-key <name> [scopes] [rateLimit]')
    console.error('  Example: pnpm create-key "sanctions-client" read 200')
    process.exit(1)
  }

  const scopes = (process.argv[3] ?? 'read').split(',')
  const rateLimit = parseInt(process.argv[4] ?? '100')

  const rawKey = `meo_${randomBytes(24).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const id = `key_${Date.now().toString(16)}_${randomBytes(4).toString('hex')}`

  await pool.query(
    `INSERT INTO api_keys (id, key_hash, name, scopes, rate_limit)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, keyHash, name, scopes, rateLimit],
  )

  await pool.end()

  console.log('\n=== API Key Created ===')
  console.log(`ID:         ${id}`)
  console.log(`Name:       ${name}`)
  console.log(`Scopes:     ${scopes.join(', ')}`)
  console.log(`Rate limit: ${rateLimit} req/min`)
  console.log(`\nAPI Key (store this now — it will NOT be shown again):`)
  console.log(`\n  ${rawKey}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
