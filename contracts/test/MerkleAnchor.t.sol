// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MerkleAnchor.sol";

contract MerkleAnchorTest is Test {
    MerkleAnchor anchor;
    address owner = address(0xBEEF);

    function setUp() public {
        anchor = new MerkleAnchor(owner);
    }

    function test_anchorRoot_stores_batch() public {
        bytes32 batchId    = keccak256("batch_2024031512");
        bytes32 merkleRoot = keccak256("root");

        vm.prank(owner);
        anchor.anchorRoot(batchId, merkleRoot, 1710500000, 1710503600, 5);

        MerkleAnchor.Batch memory b = anchor.getBatch(batchId);
        assertEq(b.merkleRoot, merkleRoot);
        assertEq(b.eventCount, 5);
        assertEq(b.submitter, owner);
        assertEq(anchor.batchCount(), 1);
    }

    function test_anchorRoot_emits_event() public {
        bytes32 batchId    = keccak256("batch_test");
        bytes32 merkleRoot = keccak256("root2");

        vm.expectEmit(true, true, false, true);
        emit MerkleAnchor.RootAnchored(batchId, merkleRoot, 1710500000, 1710503600, 3);

        vm.prank(owner);
        anchor.anchorRoot(batchId, merkleRoot, 1710500000, 1710503600, 3);
    }

    function test_anchorRoot_reverts_if_not_owner() public {
        bytes32 batchId = keccak256("batch_x");
        vm.expectRevert(MerkleAnchor.NotOwner.selector);
        anchor.anchorRoot(batchId, bytes32(0), 0, 1, 1);
    }

    function test_anchorRoot_reverts_if_duplicate() public {
        bytes32 batchId = keccak256("dup");
        vm.prank(owner);
        anchor.anchorRoot(batchId, bytes32(0), 0, 1, 1);

        vm.prank(owner);
        vm.expectRevert(MerkleAnchor.BatchExists.selector);
        anchor.anchorRoot(batchId, bytes32(0), 0, 1, 1);
    }

    function test_anchorRoot_reverts_invalid_range() public {
        bytes32 batchId = keccak256("bad_range");
        vm.prank(owner);
        vm.expectRevert(MerkleAnchor.InvalidRange.selector);
        anchor.anchorRoot(batchId, bytes32(0), 100, 50, 1); // from > to
    }

    function test_batchCount_increments() public {
        for (uint i = 0; i < 3; i++) {
            vm.prank(owner);
            anchor.anchorRoot(keccak256(abi.encode(i)), bytes32(0), 0, 1, 1);
        }
        assertEq(anchor.batchCount(), 3);
    }
}
