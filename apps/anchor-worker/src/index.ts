import { buildHourlyBatch, saveBatch } from './builder.js'
import { anchorOnChain } from './chain.js'

const CONTRACT_ADDRESS = process.env['MERKLE_ANCHOR_ADDRESS'] as `0x${string}` | undefined
const PRIVATE_KEY      = process.env['ANCHOR_PRIVATE_KEY']    as `0x${string}` | undefined
const INTERVAL_MS      = 60 * 60 * 1000  // 1 hour

async function runAnchorCycle(): Promise<void> {
  console.log('[anchor] building batch...')
  const batch = await buildHourlyBatch()

  if (!batch) {
    console.log('[anchor] no unanchored events — skipping')
    return
  }

  console.log(`[anchor] batch ${batch.batchId}: ${batch.eventCount} events, root=${batch.merkleRoot}`)

  if (!CONTRACT_ADDRESS || !PRIVATE_KEY) {
    console.warn('[anchor] CONTRACT_ADDRESS or ANCHOR_PRIVATE_KEY not set — skipping on-chain anchoring')
    return
  }

  const result = await anchorOnChain({
    contractAddress: CONTRACT_ADDRESS,
    batchId:         batch.batchIdHex,
    merkleRoot:      batch.merkleRootHex,
    eventsFrom:      batch.eventsFrom,
    eventsTo:        batch.eventsTo,
    eventCount:      batch.eventCount,
    privateKey:      PRIVATE_KEY,
  })

  await saveBatch(batch, result.txHash, result.blockNumber)
  console.log(`[anchor] anchored txHash=${result.txHash} block=${result.blockNumber}`)
}

async function main(): Promise<void> {
  console.log('[anchor-worker] starting, interval=1h')
  await runAnchorCycle()
  setInterval(runAnchorCycle, INTERVAL_MS)
}

main().catch(err => {
  console.error('[anchor-worker] fatal', err)
  process.exit(1)
})
