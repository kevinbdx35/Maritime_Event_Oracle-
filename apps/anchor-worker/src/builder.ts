import pg from 'pg'
import { buildMerkleTree, hashLeaf, getProof } from '@maritime/core'
import { createHash } from 'crypto'

const { Pool } = pg

const pool = new Pool({
  host:     process.env['DB_HOST']     ?? 'localhost',
  port:     parseInt(process.env['DB_PORT'] ?? '5432'),
  database: process.env['DB_NAME']     ?? 'maritime',
  user:     process.env['DB_USER']     ?? 'maritime',
  password: process.env['DB_PASSWORD'] ?? 'maritime_dev',
})

export interface BatchResult {
  batchId: string
  batchIdHex: `0x${string}`
  merkleRoot: string
  merkleRootHex: `0x${string}`
  eventsFrom: number
  eventsTo: number
  eventCount: number
  proofs: Map<string, string[]>  // eventId → proof path
}

/** Build a Merkle tree for all unanchored events in the past hour. */
export async function buildHourlyBatch(): Promise<BatchResult | null> {
  const now     = new Date()
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const result = await pool.query<{ id: string; event_type: string; timestamp: Date }>(
    `SELECT id, event_type, timestamp
     FROM events
     WHERE anchor_batch_id IS NULL
       AND timestamp >= $1 AND timestamp < $2
     ORDER BY id`,
    [hourAgo.toISOString(), now.toISOString()],
  )

  if (result.rows.length === 0) return null

  const rows = result.rows
  const leaves = rows.map(r =>
    hashLeaf(r.id, JSON.stringify({ id: r.id, event_type: r.event_type, timestamp: r.timestamp }))
  )

  const tree     = buildMerkleTree(leaves)
  const rootHex  = tree.getRoot().toString('hex')
  const batchId  = `batch_${hourAgo.toISOString().slice(0, 16).replace(/[:-]/g, '')}`
  const batchIdHex = `0x${createHash('sha256').update(batchId).digest('hex').slice(0, 64)}` as `0x${string}`
  const rootHex32  = rootHex.padStart(64, '0')

  const proofs = new Map<string, string[]>()
  for (let i = 0; i < rows.length; i++) {
    const p = getProof(tree, leaves[i]!)
    proofs.set(rows[i]!.id, p.proof)
  }

  return {
    batchId,
    batchIdHex,
    merkleRoot:    rootHex32,
    merkleRootHex: `0x${rootHex32}` as `0x${string}`,
    eventsFrom:    Math.floor(rows[0]!.timestamp.getTime() / 1000),
    eventsTo:      Math.floor(rows[rows.length - 1]!.timestamp.getTime() / 1000),
    eventCount:    rows.length,
    proofs,
  }
}

export async function saveBatch(
  batch: BatchResult,
  txHash: string,
  blockNumber: bigint,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO anchor_batches (id, merkle_root, hash_algo, tx_hash, block_number,
         events_from, events_to, event_count, confirmed_at)
       VALUES ($1, $2, 'sha256', $3, $4, to_timestamp($5), to_timestamp($6), $7, now())`,
      [batch.batchId, batch.merkleRoot, txHash, String(blockNumber),
       batch.eventsFrom, batch.eventsTo, batch.eventCount],
    )

    for (const [eventId, proof] of batch.proofs) {
      await client.query(
        `UPDATE events SET anchor_batch_id = $1, merkle_proof = $2 WHERE id = $3`,
        [batch.batchId, proof, eventId],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export { pool }
