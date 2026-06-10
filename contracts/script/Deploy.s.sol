// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MerkleAnchor.sol";

contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("DEPLOYER_ADDRESS");
        vm.startBroadcast();
        MerkleAnchor anchor = new MerkleAnchor(owner);
        console2.log("MerkleAnchor deployed at:", address(anchor));
        vm.stopBroadcast();
    }
}
