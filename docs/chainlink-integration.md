# Chainlink External Adapter — Integration Guide

## Overview

The Maritime Event Oracle exposes a Chainlink-compatible external adapter endpoint
that allows smart contracts to trigger on-chain verified maritime events (e.g., for
parametric insurance pay-outs on vessel delay).

**MVP status**: The endpoint interface is defined here; the adapter is NOT deployed
in the MVP. The `OracleConsumer.sol` interface in `contracts/src/` shows how a
consuming contract would interact with it.

---

## Adapter Endpoint (post-MVP)

```
POST /adapter/chainlink
Content-Type: application/json
```

### Request (Chainlink job format)
```json
{
  "id": "jobRunId",
  "data": {
    "mmsi":     "244820000",
    "locode":   "NLRTM",
    "deadline": "2024-03-15T18:00:00Z",
    "minConf":  80
  }
}
```

### Response
```json
{
  "jobRunID": "...",
  "result": {
    "arrived":      true,
    "confidence":   97,
    "eventId":      "0x...",  // keccak256 of evt_... string
    "anchorTxHash": "0x...",
    "merkleRoot":   "0x..."
  },
  "statusCode": 200
}
```

---

## Consuming Contract Flow

```
Insured ──► OracleConsumer.requestArrivalVerification(mmsi, locode, deadline)
                │
                ▼
         Chainlink node ──► POST /adapter/chainlink
                │
                ▼
         GET /vessels/:mmsi/events?type=PORT_ARRIVAL&from=...&to=deadline
                │
                ▼
         OracleConsumer.fulfill(requestId, ArrivalResult)
                │
                ▼
         Policy logic: if (!arrived && block.timestamp > deadline) → payout
```

---

## Verification Flow for Auditors

1. Get the `anchorTxHash` from the adapter response.
2. On Base Sepolia, read `MerkleAnchor.getBatch(batchId)` to get `merkleRoot`.
3. Call `GET /events/:id` to get the event + `anchor.proof[]`.
4. Recompute leaf: `sha256(eventId + "|" + canonicalJson)`.
5. Run standard Merkle proof verification against `merkleRoot`.
6. Confirm `merkleRoot` matches the on-chain value. ✓

---

## Chainlink Job Spec (TOML, post-MVP)

```toml
type                = "directrequest"
schemaVersion       = 1
name                = "Maritime Arrival Verification"
contractAddress     = "<oracle contract>"
externalJobID       = "<uuid>"

observationSource = """
  decode     [type="ethabidecodelog" ...]
  fetch      [type="bridge" name="maritime-oracle" requestData="{...}"]
  parse      [type="jsonparse" path="result.arrived"]
  encode     [type="ethabiencode" ...]

  decode -> fetch -> parse -> encode
"""
```
