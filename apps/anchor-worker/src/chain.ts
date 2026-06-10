import { createWalletClient, createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { anvil } from 'viem/chains'

const MERKLE_ANCHOR_ABI = parseAbi([
  'function anchorRoot(bytes32 batchId, bytes32 merkleRoot, uint64 eventsFrom, uint64 eventsTo, uint32 eventCount) external',
  'event RootAnchored(bytes32 indexed batchId, bytes32 indexed merkleRoot, uint64 eventsFrom, uint64 eventsTo, uint32 eventCount)',
])

export interface AnchorResult {
  txHash: string
  blockNumber: bigint
}

function getChain() {
  const rpc = process.env['ANCHOR_RPC_URL']
  if (rpc?.includes('localhost') || rpc?.includes('127.0.0.1')) return anvil
  return baseSepolia
}

export async function anchorOnChain(params: {
  contractAddress: `0x${string}`
  batchId: `0x${string}`       // bytes32
  merkleRoot: `0x${string}`    // bytes32
  eventsFrom: number
  eventsTo: number
  eventCount: number
  privateKey: `0x${string}`
}): Promise<AnchorResult> {
  const chain   = getChain()
  const rpcUrl  = process.env['ANCHOR_RPC_URL'] ?? 'http://localhost:8545'
  const account = privateKeyToAccount(params.privateKey)

  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  const hash = await walletClient.writeContract({
    address: params.contractAddress,
    abi:     MERKLE_ANCHOR_ABI,
    functionName: 'anchorRoot',
    args: [
      params.batchId,
      params.merkleRoot,
      BigInt(params.eventsFrom),
      BigInt(params.eventsTo),
      params.eventCount,
    ],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { txHash: hash, blockNumber: receipt.blockNumber }
}
