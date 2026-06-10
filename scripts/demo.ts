/**
 * demo.ts — Replay fixture → FSM → Merkle → Anvil → proof verification
 *
 * Requires only: podman compose up -d (Anvil + TimescaleDB)
 * No AISStream API key needed. No Base Sepolia testnet needed.
 *
 * Usage: pnpm demo
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil as anvilChain } from 'viem/chains'
import {
  AISMessageSchema,
  VesselStateMachine,
  computeConfidence,
  signEvent,
  generateKeypair,
  buildMerkleTree,
  hashLeaf,
  getProof,
  verifyProof,
  EVENT_SCHEMA_VERSION,
} from '@maritime/core'
import type { PositionRecord, MaritimeEvent } from '@maritime/core'
import { VesselState } from '@maritime/core'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Anvil defaults ───
const ANVIL_RPC = 'http://localhost:8545'
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`
const ANVIL_DEPLOYER    = privateKeyToAccount(ANVIL_PRIVATE_KEY)

const MERKLE_ANCHOR_ABI = [
  { type: 'constructor', inputs: [{ name: 'owner', type: 'address' }], stateMutability: 'nonpayable' },
  {
    type: 'function', name: 'anchorRoot', stateMutability: 'nonpayable',
    inputs: [
      { name: 'batchId',    type: 'bytes32' },
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'eventsFrom', type: 'uint64'  },
      { name: 'eventsTo',   type: 'uint64'  },
      { name: 'eventCount', type: 'uint32'  },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getBatch', stateMutability: 'view',
    inputs: [{ name: 'batchId', type: 'bytes32' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'merkleRoot',  type: 'bytes32' },
        { name: 'eventsFrom',  type: 'uint64'  },
        { name: 'eventsTo',    type: 'uint64'  },
        { name: 'eventCount',  type: 'uint32'  },
        { name: 'anchoredAt',  type: 'uint64'  },
        { name: 'submitter',   type: 'address' },
      ],
    }],
  },
  {
    type: 'event', name: 'RootAnchored',
    inputs: [
      { name: 'batchId',    type: 'bytes32', indexed: true  },
      { name: 'merkleRoot', type: 'bytes32', indexed: true  },
      { name: 'eventsFrom', type: 'uint64',  indexed: false },
      { name: 'eventsTo',   type: 'uint64',  indexed: false },
      { name: 'eventCount', type: 'uint32',  indexed: false },
    ],
  },
] as const

// ─── Minimal inline contract bytecode loader ───
function loadBytecode(): `0x${string}` {
  // Try foundry out/ first
  const paths = [
    join(__dirname, '../contracts/out/MerkleAnchor.sol/MerkleAnchor.json'),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      const artifact = JSON.parse(readFileSync(p, 'utf8'))
      return artifact.bytecode?.object ?? artifact.bytecode
    }
  }
  throw new Error(
    'MerkleAnchor bytecode not found. Run: cd contracts && forge build'
  )
}

async function deployContract(): Promise<`0x${string}`> {
  const bytecode = loadBytecode()
  const walletClient = createWalletClient({
    account: ANVIL_DEPLOYER,
    chain:   anvilChain,
    transport: http(ANVIL_RPC),
  })
  const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC) })

  // Encode constructor arg (owner = deployer)
  const hash = await walletClient.deployContract({
    abi:      MERKLE_ANCHOR_ABI,
    bytecode,
    args:     [ANVIL_DEPLOYER.address],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return receipt.contractAddress!
}

// ─── Replay fixture ───
function loadFixture(): unknown[] {
  const fixturePath = join(__dirname, '../fixtures/rotterdam-scenario.ndjson')
  return readFileSync(fixturePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

async function replayFixture(): Promise<MaritimeEvent[]> {
  const { privateKey } = generateKeypair()
  const messages = loadFixture()
  const fsm = new VesselStateMachine('244820000')
  const events: MaritimeEvent[] = []
  const allPositions: PositionRecord[] = []
  let trackingSince: Date | null = null

  let evtIdx = 0

  for (const raw of messages) {
    const parsed = AISMessageSchema.safeParse(raw)
    if (!parsed.success) continue

    const msg = parsed.data
    const time = new Date(msg.t)
    if (!trackingSince) trackingSince = time

    const pos: PositionRecord = {
      mmsi: msg.mmsi, time,
      lat: msg.lat, lon: msg.lon,
      sog: msg.sog, cog: msg.cog,
      source: 'aisstream',
    }
    allPositions.push(pos)

    const transition = fsm.update(pos)
    if (transition) {
      const ageMin = (time.getTime() - trackingSince.getTime()) / 60_000
      const breakdown = computeConfidence({
        windowPositions:    transition.positions,
        trackingAgeMinutes: ageMin,
        source:             'aisstream',
      })

      const id = `evt_${String(++evtIdx).padStart(4, '0')}`
      const evt: MaritimeEvent = {
        id,
        schema:    EVENT_SCHEMA_VERSION,
        vessel:    { mmsi: msg.mmsi, imo: msg.imo, name: msg.name },
        event:     transition.eventType,
        port:      'NLRTM',
        timestamp: time.toISOString(),
        confidence: breakdown.weighted_score,
        confidence_breakdown: breakdown,
        evidence: {
          positions_window: transition.positions.map(p => ({
            time: p.time.toISOString(), lat: p.lat, lon: p.lon,
            sog: p.sog, cog: p.cog,
          })),
          sources:      ['aisstream'],
          window_start: transition.positions[0]?.time.toISOString() ?? time.toISOString(),
          window_end:   transition.positions.at(-1)?.time.toISOString() ?? time.toISOString(),
          message_count: transition.positions.length,
        },
        signature: '',
        anchor:    null,
      }

      const { signature: _, ...toSign } = evt
      evt.signature = signEvent(toSign, privateKey)
      events.push(evt)

      console.log(`  ✓ [${evt.id}] ${transition.fromState} → ${transition.toState} | ${evt.event} | conf=${evt.confidence.toFixed(1)}`)
    }
  }
  return events
}

async function anchorEvents(events: MaritimeEvent[], contractAddress: `0x${string}`) {
  const walletClient = createWalletClient({
    account: ANVIL_DEPLOYER, chain: anvilChain, transport: http(ANVIL_RPC),
  })
  const publicClient = createPublicClient({ chain: anvilChain, transport: http(ANVIL_RPC) })

  const leaves  = events.map(e => hashLeaf(e.id, JSON.stringify({ id: e.id, event: e.event, timestamp: e.timestamp })))
  const tree    = buildMerkleTree(leaves)
  const root    = tree.getRoot()
  const rootHex = root.toString('hex').padStart(64, '0')

  const batchId  = 'batch_demo_001'
  const batchIdBytes32 = `0x${Buffer.from(batchId.padEnd(32, '\0')).toString('hex')}` as `0x${string}`
  const rootBytes32    = `0x${rootHex}` as `0x${string}`

  const tsFrom = Math.floor(new Date(events[0]!.timestamp).getTime() / 1000)
  const tsTo   = Math.floor(new Date(events.at(-1)!.timestamp).getTime() / 1000)

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi:     MERKLE_ANCHOR_ABI,
    functionName: 'anchorRoot',
    args: [batchIdBytes32, rootBytes32, BigInt(tsFrom), BigInt(tsTo), events.length],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })

  // Verify on-chain
  const stored = await publicClient.readContract({
    address: contractAddress,
    abi:     MERKLE_ANCHOR_ABI,
    functionName: 'getBatch',
    args:    [batchIdBytes32],
  }) as { merkleRoot: `0x${string}`; eventCount: number } | readonly unknown[]

  // viem returns the tuple object directly (single unnamed tuple output)
  const batch = (Array.isArray(stored) ? stored[0] : stored) as { merkleRoot: `0x${string}` }
  const onChainRoot = batch.merkleRoot

  console.log(`\n  ✓ On-chain root: ${onChainRoot}`)
  console.log(`  ✓ Matches local: ${onChainRoot?.slice(2) === rootHex}`)

  // Verify a proof for the first event
  const targetLeaf  = leaves[0]!
  const proofResult = getProof(tree, targetLeaf)
  const valid = verifyProof(targetLeaf, proofResult.proof, rootHex)
  console.log(`  ✓ Proof for ${events[0]!.id}: ${valid ? 'VALID' : 'INVALID'}`)

  return { txHash: hash, blockNumber: receipt.blockNumber, rootHex, leaves, tree, batchIdBytes32 }
}

// ─── Main ───
async function main(): Promise<void> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(' Maritime Event Oracle — Demo')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // 1. Replay fixture
  console.log('1. Replaying AIS fixture...')
  const events = await replayFixture()
  console.log(`   → ${events.length} events detected\n`)

  if (events.length === 0) {
    console.error('No events detected — check fixture and geo polygons')
    process.exit(1)
  }

  // 2. Deploy MerkleAnchor on Anvil
  console.log('2. Deploying MerkleAnchor on Anvil...')
  let contractAddress: `0x${string}`
  try {
    contractAddress = await deployContract()
    console.log(`   → deployed at ${contractAddress}\n`)
  } catch (err) {
    console.error('   ✗ Anvil not reachable — skipping on-chain steps')
    console.error('     Run: podman compose up -d anvil')
    process.exit(0)
  }

  // 3. Anchor + verify
  console.log('3. Building Merkle tree and anchoring on-chain...')
  const { txHash, blockNumber } = await anchorEvents(events, contractAddress)
  console.log(`   → txHash=${txHash}`)
  console.log(`   → block=${blockNumber}\n`)

  // 4. Summary
  console.log('4. Summary')
  console.log(`   events   : ${events.length}`)
  console.log(`   contract : ${contractAddress}`)
  for (const e of events) {
    console.log(`   ${e.id}  ${e.event.padEnd(18)}  conf=${e.confidence.toFixed(1).padStart(5)}  ts=${e.timestamp}`)
  }
  console.log('\n✓ Demo complete\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
