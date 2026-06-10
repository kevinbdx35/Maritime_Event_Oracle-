import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { pool } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate(): Promise<void> {
  const sql = readFileSync(join(__dirname, './schema.sql'), 'utf8')
  console.log('[migrate] applying schema...')
  await pool.query(sql)
  console.log('[migrate] done')
  await pool.end()
}

migrate().catch((err) => {
  console.error('[migrate] failed', err)
  process.exit(1)
})
