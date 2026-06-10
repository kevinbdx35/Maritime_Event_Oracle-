// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OracleConsumer (INTERFACE EXAMPLE — not implemented in MVP)
 * @notice Shows how a parametric insurance contract would consume Maritime Event
 *         Oracle data via a Chainlink external adapter.
 *
 *         See /docs/chainlink-integration.md for the full adapter specification.
 *
 *         Flow (post-MVP):
 *         1. Insured calls requestArrivalVerification(mmsi, portLocode, expectedArrivalBy)
 *         2. Chainlink node calls the external adapter at /adapter/chainlink
 *         3. Adapter queries GET /vessels/:mmsi/events?type=PORT_ARRIVAL&from=...
 *         4. Returns { arrived: bool, confidence: uint, eventId: bytes32, txHash: bytes32 }
 *         5. fulfill() is called on-chain; policy pays out if arrived=false (delay)
 */
interface IOracleConsumer {
    struct ArrivalResult {
        bool    arrived;
        uint8   confidence;      // 0-100
        bytes32 eventId;         // keccak256 of off-chain evt_... id
        bytes32 anchorTxHash;    // tx that anchored the Merkle batch
    }

    event ArrivalVerificationRequested(
        bytes32 indexed requestId,
        string  mmsi,
        string  portLocode,
        uint64  deadline
    );

    event ArrivalVerified(
        bytes32 indexed requestId,
        ArrivalResult   result
    );

    function requestArrivalVerification(
        string calldata mmsi,
        string calldata portLocode,
        uint64          deadline
    ) external returns (bytes32 requestId);
}
