import { describe, it, expect } from 'vitest'
import { hashLeaf, buildMerkleTree, getProof, verifyProof } from '../src/crypto/merkle.js'
import { signEvent, verifyEvent, generateKeypair, canonicalJson } from '../src/crypto/signer.js'

describe('Merkle tree', () => {
  const events = [
    { id: 'evt_001', json: '{"event":"PORT_ARRIVAL","mmsi":"244820000"}' },
    { id: 'evt_002', json: '{"event":"PORT_DEPARTURE","mmsi":"244820000"}' },
    { id: 'evt_003', json: '{"event":"AIS_GAP","mmsi":"244820001"}' },
  ]

  it('builds a tree and verifies a leaf proof', () => {
    const leaves = events.map(e => hashLeaf(e.id, e.json))
    const tree   = buildMerkleTree(leaves)
    const proof  = getProof(tree, leaves[1]!)

    expect(proof.root).toHaveLength(64) // sha256 hex
    expect(proof.proof.length).toBeGreaterThan(0)

    const valid = verifyProof(leaves[1]!, proof.proof, proof.root)
    expect(valid).toBe(true)
  })

  it('rejects a tampered leaf', () => {
    const leaves = events.map(e => hashLeaf(e.id, e.json))
    const tree   = buildMerkleTree(leaves)
    const proof  = getProof(tree, leaves[0]!)

    const tamperedLeaf = hashLeaf('evt_001', '{"event":"TAMPERED","mmsi":"000000000"}')
    const valid = verifyProof(tamperedLeaf, proof.proof, proof.root)
    expect(valid).toBe(false)
  })

  it('single-leaf tree works', () => {
    const leaf  = hashLeaf('evt_solo', '{"event":"PORT_ARRIVAL"}')
    const tree  = buildMerkleTree([leaf])
    const proof = getProof(tree, leaf)
    expect(verifyProof(leaf, proof.proof, proof.root)).toBe(true)
  })

  it('root changes when any leaf changes', () => {
    const leaves1 = events.map(e => hashLeaf(e.id, e.json))
    const leaves2 = [...leaves1]
    leaves2[1] = hashLeaf('evt_002', '{"event":"DIFFERENT"}')

    const root1 = buildMerkleTree(leaves1).getRoot().toString('hex')
    const root2 = buildMerkleTree(leaves2).getRoot().toString('hex')
    expect(root1).not.toBe(root2)
  })
})

describe('Ed25519 signing', () => {
  it('sign and verify round-trip', () => {
    const { privateKey, publicKey } = generateKeypair()
    const event = { id: 'evt_001', event: 'PORT_ARRIVAL', mmsi: '244820000' }
    const sig = signEvent(event, privateKey)

    expect(sig).toMatch(/^ed25519:[0-9a-f]{128}$/)
    expect(verifyEvent(event, sig, publicKey)).toBe(true)
  })

  it('rejects tampered event', () => {
    const { privateKey, publicKey } = generateKeypair()
    const event = { id: 'evt_001', event: 'PORT_ARRIVAL', mmsi: '244820000' }
    const sig = signEvent(event, privateKey)

    const tampered = { ...event, event: 'PORT_DEPARTURE' }
    expect(verifyEvent(tampered, sig, publicKey)).toBe(false)
  })

  it('canonical JSON is key-order independent', () => {
    const a = canonicalJson({ b: 2, a: 1 })
    const b = canonicalJson({ a: 1, b: 2 })
    expect(a).toBe(b)
  })
})
