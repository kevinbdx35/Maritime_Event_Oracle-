import type { FastifyInstance } from 'fastify'
import { query } from '../db.js'

export async function proofsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { batchId: string } }>('/proofs/:batchId', async (req, reply) => {
    const batch = await query(
      `SELECT * FROM anchor_batches WHERE id = $1`,
      [req.params.batchId],
    )
    if (!batch.rows[0]) return reply.code(404).send({ error: 'batch not found' })

    const b = batch.rows[0]

    const events = await query(
      `SELECT id, event_type, timestamp, mmsi, merkle_proof
       FROM events WHERE anchor_batch_id = $1 ORDER BY id`,
      [req.params.batchId],
    )

    return {
      batchId:     b['id'],
      merkleRoot:  b['merkle_root'],
      hashAlgo:    b['hash_algo'],
      txHash:      b['tx_hash'],
      blockNumber: b['block_number'],
      eventsFrom:  b['events_from'],
      eventsTo:    b['events_to'],
      eventCount:  b['event_count'],
      createdAt:   b['created_at'],
      confirmedAt: b['confirmed_at'],
      events: events.rows.map(e => ({
        id:        e['id'],
        eventType: e['event_type'],
        timestamp: e['timestamp'],
        mmsi:      e['mmsi'],
        proof:     e['merkle_proof'],
      })),
    }
  })
}
