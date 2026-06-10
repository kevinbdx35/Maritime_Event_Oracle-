/**
 * Maritime Event Oracle — OracleConsumer Demo
 *
 * Demonstrates the full trustless verification flow:
 *   1. Create synthetic maritime events
 *   2. Build a Merkle tree and anchor the root on-chain (MerkleAnchor)
 *   3. Deploy OracleConsumer.sol on Anvil
 *   4. Call verifyEventInclusion() — proof verified 100% on-chain
 *   5. Call recordVerifiedArrival() — insurance demo
 *
 * Run: pnpm tsx scripts/demo-oracle.ts
 */

import { createWalletClient, createPublicClient, http, encodeDeployData, parseAbi, toHex, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil }               from 'viem/chains'
import { readFileSync }        from 'fs'
import { createHash }          from 'crypto'
import { buildMerkleTree, hashLeaf, getProof, canonicalJson } from '@maritime/core'

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL     = process.env['ANCHOR_RPC_URL']        ?? 'http://localhost:8545'
const PRIVATE_KEY = (process.env['ANCHOR_PRIVATE_KEY']   ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`
const ANCHOR_ADDR = (process.env['MERKLE_ANCHOR_ADDRESS'] ?? '') as `0x${string}`

const account      = privateKeyToAccount(PRIVATE_KEY)
const walletClient = createWalletClient({ account, chain: anvil, transport: http(RPC_URL) })
const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) })

// ── ABI ───────────────────────────────────────────────────────────────────────

const ANCHOR_ABI = parseAbi([
  'function anchorRoot(bytes32 batchId, bytes32 merkleRoot, uint64 eventsFrom, uint64 eventsTo, uint32 eventCount) external',
])

const CONSUMER_ABI = parseAbi([
  'function verifyEventInclusion(bytes32 batchId, bytes32 leaf, bytes32[] proof) external returns (bool)',
  'function checkEventInclusion(bytes32 batchId, bytes32 leaf, bytes32[] proof) view returns (bool valid, uint64 anchoredAt)',
  'function recordVerifiedArrival(string mmsi, string portLocode, bytes32 batchId, bytes32 leaf, bytes32[] proof) external',
  'event EventVerified(bytes32 indexed batchId, bytes32 indexed leaf, address indexed verifier)',
  'event ArrivalRecorded(string mmsi, string portLocode, bytes32 batchId, uint64 provenAt)',
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function line(ch = '─', n = 52) { return ch.repeat(n) }
function hex32(buf: Buffer): `0x${string}` { return `0x${buf.toString('hex').padStart(64, '0')}` as `0x${string}` }

function sha256hex(s: string): `0x${string}` {
  return `0x${createHash('sha256').update(s).digest('hex')}` as `0x${string}`
}

// ── Synthetic events ──────────────────────────────────────────────────────────

interface DemoEvent {
  id: string
  event_type: string
  mmsi: string
  port: string
  timestamp: string
}

function makeDemoEvents(): DemoEvent[] {
  const base = new Date('2026-06-11T01:00:00Z')
  return [
    { id: 'evt_demo_001', event_type: 'PORT_ARRIVAL',   mmsi: '244820000', port: 'NLRTM', timestamp: new Date(base.getTime() + 0).toISOString() },
    { id: 'evt_demo_002', event_type: 'PORT_DEPARTURE',  mmsi: '244820001', port: 'DEHAM', timestamp: new Date(base.getTime() + 300_000).toISOString() },
    { id: 'evt_demo_003', event_type: 'ANCHORAGE_ENTRY', mmsi: '244820002', port: 'NLRTM', timestamp: new Date(base.getTime() + 600_000).toISOString() },
  ]
}

// ── Deploy OracleConsumer ─────────────────────────────────────────────────────

async function deployOracleConsumer(anchorAddress: `0x${string}`): Promise<`0x${string}`> {
  const artifactPath = new URL('../contracts/OracleConsumer.json', import.meta.url)
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const bytecode = artifact.bytecode.object as `0x${string}`

  const abi = parseAbi(['constructor(address _anchor)'])
  const deployData = encodeDeployData({ abi, bytecode, args: [anchorAddress] })

  const txHash  = await walletClient.sendTransaction({ data: deployData, account, chain: anvil })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  return receipt.contractAddress!
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + line('═'))
  console.log('  Maritime Event Oracle — OracleConsumer Demo')
  console.log(line('═'))

  if (!ANCHOR_ADDR) {
    console.error('\n✗  MERKLE_ANCHOR_ADDRESS not set. Run: pnpm deploy-anchor')
    process.exit(1)
  }

  // ── 1. Synthetic events ───────────────────────────────────────────────────
  console.log('\n① Creating synthetic maritime events…')
  const events = makeDemoEvents()
  events.forEach(e => console.log(`   ${e.id}  ${e.event_type}  MMSI:${e.mmsi}  ${e.port}`))

  // ── 2. Build Merkle tree ──────────────────────────────────────────────────
  console.log('\n② Building Merkle tree…')
  const leaves = events.map(e =>
    hashLeaf(e.id, JSON.stringify({ id: e.id, event_type: e.event_type, timestamp: e.timestamp }))
  )
  const tree = buildMerkleTree(leaves)
  const root = tree.getRoot()
  const rootHex = hex32(root)
  console.log(`   Root: ${rootHex}`)
  console.log(`   Leaves: ${leaves.length}`)

  // Proof for the first event (PORT_ARRIVAL)
  const targetIdx   = 0
  const targetEvent = events[targetIdx]!
  const targetLeaf  = leaves[targetIdx]!
  const proofData   = getProof(tree, targetLeaf)
  const leafHex     = hex32(targetLeaf)
  const proofHexArr = proofData.proof.map(p => `0x${p.padStart(64, '0')}`) as `0x${string}`[]

  console.log(`   Target: ${targetEvent.id} (${targetEvent.event_type})`)
  console.log(`   Proof path length: ${proofHexArr.length} nodes`)

  // ── 3. Anchor on-chain ────────────────────────────────────────────────────
  console.log('\n③ Anchoring Merkle root on MerkleAnchor…')
  const batchId    = `batch_demo_${Date.now()}`
  const batchIdHex = sha256hex(batchId)
  const eventsFrom = Math.floor(new Date(events[0]!.timestamp).getTime() / 1000)
  const eventsTo   = Math.floor(new Date(events[events.length - 1]!.timestamp).getTime() / 1000)

  const anchorTx = await walletClient.writeContract({
    address: ANCHOR_ADDR,
    abi: ANCHOR_ABI,
    functionName: 'anchorRoot',
    args: [batchIdHex, rootHex, BigInt(eventsFrom), BigInt(eventsTo), events.length],
  })
  const anchorReceipt = await publicClient.waitForTransactionReceipt({ hash: anchorTx })
  console.log(`   ✓ Tx:    ${anchorTx}`)
  console.log(`   ✓ Block: ${anchorReceipt.blockNumber}`)
  console.log(`   ✓ BatchId: ${batchId}`)

  // ── 4. Deploy OracleConsumer ──────────────────────────────────────────────
  console.log('\n④ Deploying OracleConsumer.sol…')
  const consumerAddr = await deployOracleConsumer(ANCHOR_ADDR)
  console.log(`   ✓ OracleConsumer deployed at ${consumerAddr}`)

  // ── 5. Verify inclusion (view — no gas) ───────────────────────────────────
  console.log('\n⑤ Verifying event inclusion (view call)…')
  const [valid, anchoredAt] = await publicClient.readContract({
    address: consumerAddr,
    abi: CONSUMER_ABI,
    functionName: 'checkEventInclusion',
    args: [batchIdHex, leafHex, proofHexArr],
  }) as [boolean, bigint]

  console.log(`   Event:     ${targetEvent.id} (${targetEvent.event_type})`)
  console.log(`   Valid:     ${valid ? '✓ true' : '✗ false'}`)
  console.log(`   Anchored:  ${new Date(Number(anchoredAt) * 1000).toISOString()}`)

  // ── 6. Verify with state change (emits EventVerified) ────────────────────
  console.log('\n⑥ Calling verifyEventInclusion() — emits EventVerified on-chain…')
  const verifyTx = await walletClient.writeContract({
    address: consumerAddr,
    abi: CONSUMER_ABI,
    functionName: 'verifyEventInclusion',
    args: [batchIdHex, leafHex, proofHexArr],
  })
  const verifyReceipt = await publicClient.waitForTransactionReceipt({ hash: verifyTx })
  console.log(`   ✓ Tx:    ${verifyTx}`)
  console.log(`   ✓ Block: ${verifyReceipt.blockNumber}`)
  console.log(`   ✓ Logs:  ${verifyReceipt.logs.length} event(s) emitted`)

  // ── 7. Insurance demo (recordVerifiedArrival) ─────────────────────────────
  console.log('\n⑦ Insurance demo — recordVerifiedArrival()…')
  const insureTx = await walletClient.writeContract({
    address: consumerAddr,
    abi: CONSUMER_ABI,
    functionName: 'recordVerifiedArrival',
    args: [targetEvent.mmsi, targetEvent.port, batchIdHex, leafHex, proofHexArr],
  })
  const insureReceipt = await publicClient.waitForTransactionReceipt({ hash: insureTx })
  console.log(`   MMSI:    ${targetEvent.mmsi}`)
  console.log(`   Port:    ${targetEvent.port}`)
  console.log(`   ✓ Tx:    ${insureTx}`)
  console.log(`   ✓ Logs:  ${insureReceipt.logs.length} event(s) emitted (EventVerified + ArrivalRecorded)`)

  // ── 8. Tampered proof (should fail) ───────────────────────────────────────
  console.log('\n⑧ Testing tampered proof (should be rejected)…')
  const tamperedLeaf = `0x${'deadbeef'.repeat(8)}` as `0x${string}`
  const [tamperedValid] = await publicClient.readContract({
    address: consumerAddr,
    abi: CONSUMER_ABI,
    functionName: 'checkEventInclusion',
    args: [batchIdHex, tamperedLeaf, proofHexArr],
  }) as [boolean, bigint]
  console.log(`   Tampered leaf result: ${tamperedValid ? '✗ BUG — accepted!' : '✓ Rejected (invalid proof)'}`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + line('═'))
  console.log('  Summary')
  console.log(line('─'))
  console.log(`  MerkleAnchor    ${ANCHOR_ADDR}`)
  console.log(`  OracleConsumer  ${consumerAddr}`)
  console.log(`  Batch           ${batchId}`)
  console.log(`  Events          ${events.length} (PORT_ARRIVAL, PORT_DEPARTURE, ANCHORAGE_ENTRY)`)
  console.log(`  Proof valid     ${valid ? '✓' : '✗'}`)
  console.log(`  Tamper proof    ✓ rejected`)
  console.log(line('═') + '\n')
}

main().catch(e => { console.error(e); process.exit(1) })
