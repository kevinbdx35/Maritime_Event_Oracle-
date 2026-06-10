# Emissions Verification Guide — Katalist / Book & Claim

## Purpose

The Maritime Event Oracle generates a signed `VOYAGE_SUMMARY` for each port call.
This document explains how a third-party verifier (e.g. Katalist, a Book & Claim
auditor, or a fuel certifier) can consume and independently verify these summaries.

---

## What the summary contains

```json
{
  "id": "voy_...",
  "schema": "voyage-summary/v1",
  "vessel": { "mmsi": "244820000", "imo": "9234567", "name": "ATLANTIC PIONEER" },
  "port": "NLRTM",
  "arrival_event_id":   "evt_...",
  "departure_event_id": "evt_...",
  "period": { "from": "2024-03-15T07:35:00Z", "to": "2024-03-15T12:55:00Z" },
  "distance_nm": 0.3,
  "speed_profile": { "p50_knots": 0.1, "p95_knots": 0.4, "samples": 12 },
  "time_breakdown": {
    "total_hours": 5.33,
    "underway_hours": 0.42,
    "anchored_hours": 0.00,
    "moored_hours": 4.91
  },
  "signature": "ed25519:...",
  "anchor": { "batchId": "...", "merkleRoot": "0x...", "txHash": "0x...", "proof": ["0x..."] }
}
```

---

## Verification steps for an auditor

### 1. Retrieve the summary

```bash
curl https://api.maritime-oracle.example/voyages/<voy_id>/summary
```

### 2. Verify the Ed25519 signature

The oracle's public key is published at `/pubkey` and in the README.

```typescript
import { verifyEvent } from '@maritime/core'
const valid = verifyEvent(summary, summary.signature, ORACLE_PUBLIC_KEY)
```

### 3. Verify on-chain inclusion (Merkle proof)

```typescript
import { hashLeaf, verifyProof } from '@maritime/core'

// Verify the arrival event
const leaf = hashLeaf(arrivalEvent.id, JSON.stringify({
  id: arrivalEvent.id,
  event: arrivalEvent.event,
  timestamp: arrivalEvent.timestamp,
}))
const valid = verifyProof(leaf, arrivalEvent.anchor.proof, arrivalEvent.anchor.merkleRoot)

// Confirm root is on-chain
// Read MerkleAnchor.getBatch(batchIdBytes32) on Base Sepolia
// → merkleRoot must match arrivalEvent.anchor.merkleRoot
```

### 4. Cross-check the raw evidence

The `GET /events/:id` endpoint returns `evidence.positions_window` — the raw AIS
positions that triggered the event. An auditor can spot-check against public AIS
replay services (MarineTraffic, VesselFinder) for the same MMSI and time window.

---

## Limitations (Garbage In, Garbage Out)

| What the proof guarantees | What it does NOT guarantee |
|---|---|
| The oracle observed these AIS messages at this time | The AIS transponder was not spoofed |
| The event was signed by our key at creation | The vessel actually consumed X tonnes of fuel |
| The Merkle root is immutably on-chain | The MMSI belongs to the claimed vessel |
| The signature cannot be forged without our private key | The data source (AISStream) was not compromised |

**Use case**: the summary provides "reasonable assurance" for Book & Claim fuel
verification (ISCC+, RSB, etc.) as a corroborating data source, not a primary
measurement. Fuel consumption estimation requires additional ETA/ATA port records
and noon reports from the vessel operator.

---

## Katalist Integration Example

```typescript
// Katalist verifier calls:
const response = await fetch(`${ORACLE_BASE}/voyages/${voyageId}/summary`)
const summary  = await response.json()

// 1. Verify signature
assert(verifyEvent(summary, summary.signature, ORACLE_PUBLIC_KEY))

// 2. Verify on-chain anchor
const onChainRoot = await readContract({ ... MerkleAnchor.getBatch(batchId) ... })
assert(onChainRoot === summary.anchor.merkleRoot)

// 3. Use summary for fuel estimation
const fuelEstimate = summary.distance_nm * VESSEL_CONSUMPTION_FACTOR_MT_PER_NM
// + idle time at anchor × IDLE_CONSUMPTION_FACTOR
```
