// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcSixHourOracle} from './GpcSixHourOracle.sol';
import {GpcMainnetAddresses} from './GpcMainnetAddresses.sol';

contract GpcMainnetOracle is GpcSixHourOracle {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __GpcSixHourOracle_init(
            GpcMainnetAddresses.PANCAKE_ROUTER,
            GpcMainnetAddresses.GPC,
            GpcMainnetAddresses.WBNB,
            GpcMainnetAddresses.USDT
        );
    }
}
