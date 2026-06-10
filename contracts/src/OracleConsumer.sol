// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OracleConsumer
 * @notice Demo contract showing how a third party verifies Maritime Event Oracle
 *         data fully on-chain, without trusting any off-chain intermediary.
 *
 * Flow:
 *   1. Oracle anchors a Merkle root via MerkleAnchor.anchorRoot()
 *   2. Any contract calls verifyEventInclusion() with:
 *      - batchId  : identifies the anchored batch
 *      - leaf     : sha256(eventId + "|" + canonicalJson)
 *      - proof[]  : sibling hashes from the Merkle tree
 *   3. The function fetches the stored root from MerkleAnchor and verifies
 *      the proof locally — zero trust in the oracle after anchoring.
 *
 * Use case: parametric insurance that pays out when a PORT_ARRIVAL is proven.
 */

interface IMerkleAnchor {
    struct Batch {
        bytes32 merkleRoot;
        uint64  eventsFrom;
        uint64  eventsTo;
        uint32  eventCount;
        uint64  anchoredAt;
        address submitter;
    }
    function getBatch(bytes32 batchId) external view returns (Batch memory);
}

contract OracleConsumer {

    IMerkleAnchor public immutable anchor;

    // ── Events ────────────────────────────────────────────────────────────────

    /// Emitted whenever an event inclusion proof is successfully verified.
    event EventVerified(
        bytes32 indexed batchId,
        bytes32 indexed leaf,
        address indexed verifier
    );

    /// Emitted by the insurance demo when an arrival is proven and recorded.
    event ArrivalRecorded(
        string  mmsi,
        string  portLocode,
        bytes32 batchId,
        uint64  provenAt
    );

    // ── Errors ────────────────────────────────────────────────────────────────

    error BatchNotFound(bytes32 batchId);
    error InvalidProof();

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _anchor) {
        anchor = IMerkleAnchor(_anchor);
    }

    // ── Core verification ─────────────────────────────────────────────────────

    /**
     * @notice Verify that an event leaf is included in an anchored Merkle batch.
     * @param batchId  keccak/sha256 of the off-chain batch identifier string
     * @param leaf     sha256(eventId + "|" + canonicalJson) — computed off-chain
     * @param proof    Sibling hashes from the Merkle tree (sorted pairs)
     * @return valid   True if the leaf is provably in the batch
     */
    function verifyEventInclusion(
        bytes32          batchId,
        bytes32          leaf,
        bytes32[] calldata proof
    ) external returns (bool valid) {
        IMerkleAnchor.Batch memory batch = anchor.getBatch(batchId);
        if (batch.anchoredAt == 0) revert BatchNotFound(batchId);

        valid = _verifyProof(proof, leaf, batch.merkleRoot);
        if (valid) emit EventVerified(batchId, leaf, msg.sender);
    }

    /**
     * @notice Read-only variant — does not emit events, usable in view contexts.
     */
    function checkEventInclusion(
        bytes32          batchId,
        bytes32          leaf,
        bytes32[] calldata proof
    ) external view returns (bool valid, uint64 anchoredAt) {
        IMerkleAnchor.Batch memory batch = anchor.getBatch(batchId);
        if (batch.anchoredAt == 0) return (false, 0);
        valid      = _verifyProof(proof, leaf, batch.merkleRoot);
        anchoredAt = batch.anchoredAt;
    }

    // ── Insurance demo ────────────────────────────────────────────────────────

    /**
     * @notice Record a verified PORT_ARRIVAL on-chain (insurance payout trigger).
     *         Reverts if the proof is invalid — no oracle trust required.
     * @param mmsi       Vessel MMSI string (e.g. "244820000")
     * @param portLocode UN/LOCODE of the arrival port (e.g. "NLRTM")
     * @param batchId    Anchor batch that contains this event
     * @param leaf       sha256(eventId + "|" + canonicalJson)
     * @param proof      Merkle proof path
     */
    function recordVerifiedArrival(
        string    calldata mmsi,
        string    calldata portLocode,
        bytes32            batchId,
        bytes32            leaf,
        bytes32[] calldata proof
    ) external {
        IMerkleAnchor.Batch memory batch = anchor.getBatch(batchId);
        if (batch.anchoredAt == 0) revert BatchNotFound(batchId);
        if (!_verifyProof(proof, leaf, batch.merkleRoot)) revert InvalidProof();

        emit EventVerified(batchId, leaf, msg.sender);
        emit ArrivalRecorded(mmsi, portLocode, batchId, uint64(block.timestamp));
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    // Standard Merkle proof verification with sorted pairs (merkletreejs sortPairs:true)
    // using SHA-256, matching hashLeaf / buildMerkleTree in the core package.
    function _verifyProof(
        bytes32[] calldata proof,
        bytes32            leaf,
        bytes32            root
    ) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = _hashPair(computed, proof[i]);
        }
        return computed == root;
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        // sortPairs: true — smaller value goes first
        return a <= b
            ? sha256(abi.encodePacked(a, b))
            : sha256(abi.encodePacked(b, a));
    }
}
