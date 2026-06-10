// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MerkleAnchor
 * @notice Minimal on-chain registry for hourly Merkle roots of maritime events.
 *         Each root commits to a batch of signed events. Anyone can verify an
 *         event's inclusion off-chain using the standard Merkle proof algorithm.
 *
 *         Security model:
 *         - The contract stores roots; it does NOT validate event content.
 *         - Trust assumption: the oracle operator controls the signing key and
 *           the anchor submission. A compromised key can submit false roots.
 *         - Immutability: once anchored, a root cannot be modified or deleted.
 *         - The tx timestamp + block hash provide an independent time witness.
 */
contract MerkleAnchor {
    struct Batch {
        bytes32 merkleRoot;
        uint64  eventsFrom;   // unix timestamp (seconds)
        uint64  eventsTo;     // unix timestamp (seconds)
        uint32  eventCount;
        uint64  anchoredAt;   // block.timestamp
        address submitter;
    }

    // batchId (off-chain string hash) → Batch
    mapping(bytes32 => Batch) public batches;
    bytes32[] public batchIds;

    address public immutable owner;

    event RootAnchored(
        bytes32 indexed batchId,
        bytes32 indexed merkleRoot,
        uint64  eventsFrom,
        uint64  eventsTo,
        uint32  eventCount
    );

    error NotOwner();
    error BatchExists();
    error InvalidRange();

    constructor(address _owner) {
        owner = _owner;
    }

    /**
     * @notice Anchor a Merkle root for a batch of maritime events.
     * @param batchId     Off-chain batch identifier (keccak256 of batch string id)
     * @param merkleRoot  SHA-256/keccak256 root of the event leaf hashes
     * @param eventsFrom  Unix timestamp of the earliest event in the batch
     * @param eventsTo    Unix timestamp of the latest event in the batch
     * @param eventCount  Number of events committed
     */
    function anchorRoot(
        bytes32 batchId,
        bytes32 merkleRoot,
        uint64  eventsFrom,
        uint64  eventsTo,
        uint32  eventCount
    ) external {
        if (msg.sender != owner)          revert NotOwner();
        if (batches[batchId].anchoredAt != 0) revert BatchExists();
        if (eventsFrom > eventsTo)        revert InvalidRange();

        batches[batchId] = Batch({
            merkleRoot:  merkleRoot,
            eventsFrom:  eventsFrom,
            eventsTo:    eventsTo,
            eventCount:  eventCount,
            anchoredAt:  uint64(block.timestamp),
            submitter:   msg.sender
        });
        batchIds.push(batchId);

        emit RootAnchored(batchId, merkleRoot, eventsFrom, eventsTo, eventCount);
    }

    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    function batchCount() external view returns (uint256) {
        return batchIds.length;
    }
}
