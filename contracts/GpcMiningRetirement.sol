// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcMiningRetirementCore} from './GpcMiningRetirementCore.sol';
import {GpcMainnetAddresses} from './GpcMainnetAddresses.sol';

/**
 * @notice Retirement-only implementation for the superseded BSC mining proxy.
 */
contract GpcMiningRetirement is GpcMiningRetirementCore {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address sixHourOracle, address governanceOwner) external initializer {
        __GpcMiningCore_init(
            GpcMainnetAddresses.USDT,
            GpcMainnetAddresses.GPC,
            GpcMainnetAddresses.WBNB,
            GpcMainnetAddresses.PANCAKE_ROUTER,
            sixHourOracle,
            GpcMainnetAddresses.OPERATION_WALLET,
            governanceOwner
        );
    }
}
