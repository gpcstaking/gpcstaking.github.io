// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcHistoryRegistry} from '../GpcHistoryRegistry.sol';

/// @custom:oz-upgrades-unsafe-allow missing-initializer
contract GpcHistoryRegistryV2 is GpcHistoryRegistry {
    function implementationVersion() external pure returns (uint256) {
        return 2;
    }
}
