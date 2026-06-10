import { MerkleTree } from 'merkletreejs'
import { createHash } from 'crypto'

function keccak256(data: Buffer): Buffer {
  // Using SHA-256 for Node.js compatibility in tests;
  // the Solidity contract uses keccak256 — swap to keccak256 lib when deploying.
  // ADR-003: we use sha256 in tests, keccak256 in production anchoring.
  return createHash('sha256').update(data).digest()
}

export function hashLeaf(eventId: string, canonicalJson: string): Buffer {
  const data = Buffer.from(eventId + '|' + canonicalJson, 'utf8')
  return keccak256(data)
}

export interface MerkleProof {
  root: string          // hex, no 0x prefix
  proof: string[]       // hex array
  leaf: string          // hex
}

export function buildMerkleTree(leaves: Buffer[]): MerkleTree {
  return new MerkleTree(leaves, keccak256, { sortPairs: true })
}

export function getProof(tree: MerkleTree, leaf: Buffer): MerkleProof {
  const root  = tree.getRoot().toString('hex')
  const proof = tree.getProof(leaf).map(p => p.data.toString('hex'))
  const leafHex = leaf.toString('hex')
  return { root, proof, leaf: leafHex }
}

export function verifyProof(
  leaf: Buffer,
  proof: string[],
  root: string,
): boolean {
  const tree = new MerkleTree([], keccak256, { sortPairs: true })
  const proofBuffers = proof.map(p => Buffer.from(p, 'hex'))
  return tree.verify(proofBuffers, leaf, Buffer.from(root, 'hex'))
}
