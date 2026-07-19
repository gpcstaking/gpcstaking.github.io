// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcMiningRetirementCore} from '../GpcMiningRetirementCore.sol';

contract GpcMiningRetirementHarness is GpcMiningRetirementCore {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address usdt_,
        address gpc_,
        address wbnb_,
        address router_,
        address oracle_,
        address operationWallet_,
        address governanceOwner_
    ) external initializer {
        __GpcMiningCore_init(usdt_, gpc_, wbnb_, router_, oracle_, operationWallet_, governanceOwner_);
    }
}
