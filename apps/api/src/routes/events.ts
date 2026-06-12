import type { FastifyInstance } from 'fastify'
import { query } from '../db.js'

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  // GET /events/:id — full event with proof
  app.get<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const result = await query(
      `SELECT e.*,
              ab.merkle_root, ab.tx_hash, ab.block_number, ab.hash_algo
       FROM events e
       LEFT JOIN anchor_batches ab ON ab.id = e.anchor_batch_id
       WHERE e.id = $1`,
      [req.params.id],
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'not found' })

    const row = result.rows[0]
    return reply.send(formatEvent(row))
  })

  // GET /events?type=&from=&to=&mmsi=&limit=&cursor=
  app.get<{
    Querystring: {
      type?: string; from?: string; to?: string
      mmsi?: string; limit?: string; cursor?: string
    }
  }>('/events', async (req) => {
    const parsed = parseInt(req.query.limit ?? '50')
    const limit = Number.isNaN(parsed) ? 50 : Math.min(Math.max(parsed, 1), 200)
    const params: unknown[] = []
    const where: string[] = ['1=1']

    if (req.query.type)   { params.push(req.query.type);   where.push(`event_type = $${params.length}`) }
    if (req.query.mmsi)   { params.push(req.query.mmsi);   where.push(`mmsi = $${params.length}`) }
    if (req.query.from)   { params.push(req.query.from);   where.push(`timestamp >= $${params.length}`) }
    if (req.query.to)     { params.push(req.query.to);     where.push(`timestamp <= $${params.length}`) }
    if (req.query.cursor) { params.push(req.query.cursor); where.push(`id < $${params.length}`) }

    params.push(limit + 1)
    const result = await query(
      `SELECT e.*, ab.merkle_root, ab.tx_hash, ab.block_number, ab.hash_algo
       FROM events e
       LEFT JOIN anchor_batches ab ON ab.id = e.anchor_batch_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.id DESC
       LIMIT $${params.length}`,
      params,
    )
    const rows = result.rows
    const hasMore = rows.length > limit
    if (hasMore) rows.pop()

    return {
      data: rows.map(formatEvent),
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore ? rows[rows.length - 1]?.id : undefined,
      },
    }
  })
}

function formatEvent(row: Record<string, unknown>) {
  return {
    id: row['id'],
    schema: row['schema_version'],
    vessel: {
      mmsi: row['mmsi'],
      imo:  row['imo'],
      name: row['vessel_name'],
    },
    event:     row['event_type'],
    port:      row['port'],
    timestamp: row['timestamp'],
    confidence: row['confidence'],
    confidence_breakdown: row['confidence_breakdown'],
    evidence:  row['evidence'],
    signature: row['signature'],
    anchor: row['merkle_root'] ? {
      batchId:    row['anchor_batch_id'],
      merkleRoot: row['merkle_root'],
      txHash:     row['tx_hash'],
      blockNumber: row['block_number'],
      proof:      row['merkle_proof'] ?? [],
    } : null,
    gap: row['gap_meta'] ?? undefined,
    corrects: row['corrects'] ?? undefined,
  }
}
