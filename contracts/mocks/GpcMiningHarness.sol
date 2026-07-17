// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {GpcMiningCore} from '../GpcMiningCore.sol';

contract GpcMiningHarness is GpcMiningCore {
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

    function setWithdrawWindowForTest(uint256 startedAt, uint256 poolBase, uint256 withdrawn) external {
        withdrawWindowStartedAt = startedAt;
        withdrawWindowPoolBase = poolBase;
        withdrawnGpcInWindow = withdrawn;
    }
}
