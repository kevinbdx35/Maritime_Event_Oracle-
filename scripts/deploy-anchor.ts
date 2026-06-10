/**
 * Deploy MerkleAnchor contract to Anvil (or any EVM RPC).
 * Reads compiled bytecode from contracts/out/; no Forge needed.
 * Appends MERKLE_ANCHOR_ADDRESS to .env on success.
 */
import { createWalletClient, createPublicClient, http, parseAbi, encodeDeployData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvil, baseSepolia } from 'viem/chains'
import { readFileSync, appendFileSync, readFileSync as rf } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dir  = dirname(fileURLToPath(import.meta.url))
const root   = resolve(__dir, '..')

const PRIVATE_KEY = (process.env['ANCHOR_PRIVATE_KEY'] ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`
const RPC_URL     = process.env['ANCHOR_RPC_URL'] ?? 'http://localhost:8545'
const isLocal     = RPC_URL.includes('localhost') || RPC_URL.includes('127.0.0.1')
const chain       = isLocal ? anvil : baseSepolia

const artifactPath = resolve(root, 'contracts/out/MerkleAnchor.sol/MerkleAnchor.json')
const artifact     = JSON.parse(readFileSync(artifactPath, 'utf8'))
const bytecode     = artifact.bytecode.object as `0x${string}`

const ABI = parseAbi(['constructor(address owner)'])

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY)
  console.log(`Deploying MerkleAnchor from ${account.address} to ${RPC_URL}...`)

  const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) })
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })

  const deployData = encodeDeployData({
    abi: ABI,
    bytecode,
    args: [account.address],
  })

  const txHash = await walletClient.sendTransaction({ data: deployData, account, chain })
  console.log(`Deploy tx: ${txHash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  const contractAddress = receipt.contractAddress!

  console.log(`\nMerkleAnchor deployed at: ${contractAddress}`)
  console.log(`Block: ${receipt.blockNumber}`)

  // Append to .env (only if not already set)
  const envPath = resolve(root, '.env')
  const existing = readFileSync(envPath, 'utf8')
  if (!existing.includes('MERKLE_ANCHOR_ADDRESS=')) {
    appendFileSync(envPath, `\nMERKLE_ANCHOR_ADDRESS=${contractAddress}\n`)
    console.log(`\nWritten MERKLE_ANCHOR_ADDRESS to .env`)
  } else {
    console.log(`\n⚠  MERKLE_ANCHOR_ADDRESS already in .env — update manually if needed`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
