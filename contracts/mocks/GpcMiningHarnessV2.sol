// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcMiningHarness} from './GpcMiningHarness.sol';

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract GpcMiningHarnessV2 is GpcMiningHarness {
    function implementationVersion() external pure returns (uint256) {
        return 2;
    }
}
