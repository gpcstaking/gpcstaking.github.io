// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcMiningCore} from './GpcMiningCore.sol';
import {GpcMainnetAddresses} from './GpcMainnetAddresses.sol';

/**
 * @notice BSC mainnet deployment with publicly fixed token, router and operation addresses.
 */
contract GpcMining is GpcMiningCore {
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
