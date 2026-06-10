import { ed25519 } from '@noble/curves/ed25519'
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils'

/** Canonical JSON: sorted keys, no whitespace. */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedReplacer)
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    )
  }
  return value
}

export function generateKeypair(): { privateKey: string; publicKey: string } {
  const priv = ed25519.utils.randomPrivateKey()
  const pub  = ed25519.getPublicKey(priv)
  return {
    privateKey: bytesToHex(priv),
    publicKey:  bytesToHex(pub),
  }
}

export function signEvent(eventJson: unknown, privateKeyHex: string): string {
  const msg = new TextEncoder().encode(canonicalJson(eventJson))
  const sig = ed25519.sign(msg, hexToBytes(privateKeyHex))
  return `ed25519:${bytesToHex(sig)}`
}

export function verifyEvent(eventJson: unknown, signature: string, publicKeyHex: string): boolean {
  try {
    const sigHex = signature.replace(/^ed25519:/, '')
    const msg = new TextEncoder().encode(canonicalJson(eventJson))
    return ed25519.verify(hexToBytes(sigHex), msg, hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}
