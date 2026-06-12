import type { FastifyInstance } from 'fastify'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'
import { query } from '../db.js'

const ADMIN_SECRET = process.env['ADMIN_SECRET'] ?? ''

function secretMatches(provided: unknown): boolean {
  if (!ADMIN_SECRET || typeof provided !== 'string') return false
  // Compare digests so lengths always match — keeps the comparison constant-time
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(ADMIN_SECRET).digest()
  return timingSafeEqual(a, b)
}

function requireAdmin(req: { headers: Record<string, unknown> }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): boolean {
  if (!secretMatches(req.headers['x-admin-secret'])) {
    reply.code(403).send({ error: 'Forbidden' })
    return false
  }
  return true
}

export async function keysRoutes(app: FastifyInstance): Promise<void> {
  // POST /admin/keys — create new API key
  app.post<{ Body: { name: string; scopes?: string[]; rateLimit?: number } }>(
    '/admin/keys',
    { schema: { body: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, scopes: { type: 'array' }, rateLimit: { type: 'number' },
    } } } },
    async (req, reply) => {
      if (!requireAdmin(req as Parameters<typeof requireAdmin>[0], reply as Parameters<typeof requireAdmin>[1])) return

      const rawKey = `meo_${randomBytes(24).toString('hex')}`
      const keyHash = createHash('sha256').update(rawKey).digest('hex')
      const id = `key_${Date.now().toString(16)}_${randomBytes(4).toString('hex')}`
      const scopes = req.body.scopes ?? ['read']
      const rateLimit = req.body.rateLimit ?? 100

      await query(
        `INSERT INTO api_keys (id, key_hash, name, scopes, rate_limit)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, keyHash, req.body.name, scopes, rateLimit],
      )

      // Raw key is only returned once — caller must store it
      return reply.code(201).send({ id, key: rawKey, scopes, rateLimit })
    },
  )

  // GET /admin/keys — list all keys (no raw keys)
  app.get('/admin/keys', async (req, reply) => {
    if (!requireAdmin(req as Parameters<typeof requireAdmin>[0], reply as Parameters<typeof requireAdmin>[1])) return

    const result = await query(
      `SELECT id, name, scopes, rate_limit, created_at, last_used_at, revoked_at
       FROM api_keys ORDER BY created_at DESC`,
    )
    return reply.send({ data: result.rows })
  })

  // DELETE /admin/keys/:id — revoke a key
  app.delete<{ Params: { id: string } }>('/admin/keys/:id', async (req, reply) => {
    if (!requireAdmin(req as Parameters<typeof requireAdmin>[0], reply as Parameters<typeof requireAdmin>[1])) return

    await query(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [req.params.id],
    )
    return reply.code(204).send()
  })
}
