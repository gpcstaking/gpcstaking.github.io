// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcSixHourOracleHarness} from './GpcSixHourOracleHarness.sol';

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract GpcSixHourOracleHarnessV2 is GpcSixHourOracleHarness {
    function implementationVersion() external pure returns (uint256) {
        return 2;
    }
}
