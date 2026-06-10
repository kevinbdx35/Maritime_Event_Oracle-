import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  host:     process.env['DB_HOST']     ?? 'localhost',
  port:     parseInt(process.env['DB_PORT'] ?? '5432'),
  database: process.env['DB_NAME']     ?? 'maritime',
  user:     process.env['DB_USER']     ?? 'maritime',
  password: process.env['DB_PASSWORD'] ?? 'maritime_dev',
  max: 10,
})

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params)
}
