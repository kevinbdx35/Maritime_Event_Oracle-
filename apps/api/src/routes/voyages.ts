import type { FastifyInstance } from 'fastify'
import { query } from '../db.js'

export async function voyagesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/voyages/:id/summary', async (req, reply) => {
    const result = await query(
      `SELECT v.*, ab.merkle_root, ab.tx_hash, ab.block_number
       FROM voyages v
       LEFT JOIN anchor_batches ab ON ab.id = v.anchor_batch_id
       WHERE v.id = $1`,
      [req.params.id],
    )
    if (!result.rows[0]) return reply.code(404).send({ error: 'voyage not found' })

    const row = result.rows[0]
    // Return the full signed summary JSON plus anchor proof
    return {
      ...(row['summary'] as object),
      anchor: row['merkle_root'] ? {
        batchId:    row['anchor_batch_id'],
        merkleRoot: row['merkle_root'],
        txHash:     row['tx_hash'],
        blockNumber: row['block_number'],
      } : null,
    }
  })
}
