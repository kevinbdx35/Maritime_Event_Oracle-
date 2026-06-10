import type { FastifyInstance } from 'fastify'
import { verifyEvent, canonicalJson, hashLeaf, verifyProof } from '@maritime/core'
import { query } from '../db.js'

type SignatureBody = {
  type: 'signature'
  event: Record<string, unknown>
}

type MerkleBody = {
  type: 'merkle'
  eventId: string
  canonicalJson: string
  proof: string[]
  root: string
}

type VerifyBody = SignatureBody | MerkleBody

export async function verifyRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: VerifyBody }>('/verify', async (req, reply) => {
    const body = req.body

    // ── Ed25519 signature verification ───────────────────────────────────────
    if (body.type === 'signature') {
      const publicKey = process.env['EVT_PUBLIC_KEY']
      if (!publicKey) {
        return reply.code(503).send({ error: 'EVT_PUBLIC_KEY not configured on this server' })
      }

      const { signature, ...eventWithoutSig } = body.event
      if (!signature || typeof signature !== 'string') {
        return reply.code(400).send({ error: 'event.signature field is required' })
      }

      const valid = verifyEvent(eventWithoutSig, signature, publicKey)
      return {
        valid,
        type:      'signature',
        publicKey,
        message:   valid ? 'Signature is authentic' : 'Signature does not match',
      }
    }

    // ── Merkle proof verification ─────────────────────────────────────────────
    if (body.type === 'merkle') {
      const { eventId, canonicalJson: cj, proof, root } = body

      if (!eventId || !cj || !Array.isArray(proof) || !root) {
        return reply.code(400).send({ error: 'eventId, canonicalJson, proof[], and root are required' })
      }

      const leaf  = hashLeaf(eventId, cj)
      const valid = verifyProof(leaf, proof, root)

      // Cross-check root against DB anchor_batches
      let rootKnown = false
      let txHash: string | null = null
      let blockNumber: number | null = null
      try {
        const res = await query<{ tx_hash: string; block_number: number }>(
          `SELECT tx_hash, block_number FROM anchor_batches WHERE merkle_root = $1`,
          [root],
        )
        if (res.rows[0]) {
          rootKnown   = true
          txHash      = res.rows[0].tx_hash ?? null
          blockNumber = res.rows[0].block_number ?? null
        }
      } catch { /* DB unavailable — verification still works locally */ }

      const result: Record<string, unknown> = { valid, type: 'merkle', rootKnown }
      if (txHash      !== null) result['txHash']      = txHash
      if (blockNumber !== null) result['blockNumber'] = blockNumber
      result['message'] = valid
        ? rootKnown
          ? 'Proof valid and root is anchored on-chain'
          : 'Proof is mathematically valid but root not found in this node\'s DB'
        : 'Proof is invalid'

      return result
    }

    return reply.code(400).send({ error: 'type must be "signature" or "merkle"' })
  })
}
