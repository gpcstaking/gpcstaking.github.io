// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcSixHourOracle} from '../GpcSixHourOracle.sol';

contract GpcSixHourOracleHarness is GpcSixHourOracle {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address router_, address gpc_, address wbnb_, address usdt_) external initializer {
        __GpcSixHourOracle_init(router_, gpc_, wbnb_, usdt_);
    }
}
