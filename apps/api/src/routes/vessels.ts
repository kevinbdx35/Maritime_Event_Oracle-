import type { FastifyInstance } from 'fastify'
import { query } from '../db.js'

export async function vesselsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { mmsi: string }
    Querystring: { limit?: string; type?: string; from?: string; to?: string }
  }>('/vessels/:mmsi/events', async (req, reply) => {
    const { mmsi } = req.params
    if (!/^\d{9}$/.test(mmsi)) return reply.code(400).send({ error: 'invalid mmsi' })

    const limit = Math.min(parseInt(req.query.limit ?? '50'), 200)
    const params: unknown[] = [mmsi]
    const where = [`mmsi = $1`]

    if (req.query.type) { params.push(req.query.type); where.push(`event_type = $${params.length}`) }
    if (req.query.from) { params.push(req.query.from); where.push(`timestamp >= $${params.length}`) }
    if (req.query.to)   { params.push(req.query.to);   where.push(`timestamp <= $${params.length}`) }

    params.push(limit)
    const result = await query(
      `SELECT e.*, ab.merkle_root, ab.tx_hash, ab.block_number
       FROM events e
       LEFT JOIN anchor_batches ab ON ab.id = e.anchor_batch_id
       WHERE ${where.join(' AND ')}
       ORDER BY timestamp DESC LIMIT $${params.length}`,
      params,
    )

    return { mmsi, events: result.rows }
  })
}
