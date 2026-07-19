// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {GpcMiningCore} from './GpcMiningCore.sol';

/**
 * @notice One-purpose implementation used only to retire the superseded mining proxy.
 * @dev This capability is deliberately excluded from the replacement production implementation.
 */
abstract contract GpcMiningRetirementCore is GpcMiningCore {
    using SafeERC20 for IERC20;

    address public constant RETIREMENT_RECIPIENT = 0xC34622e54f259304877A10A901caa332250A84f5;

    /**
     * @notice Moves every GPC held by the paused legacy proxy to the fixed replacement operation Safe.
     */
    function retireOldMiningPool() external onlyOwner whenPaused {
        uint256 amount = gpc.balanceOf(address(this));
        miningPoolGpc = 0;
        gpc.safeTransfer(RETIREMENT_RECIPIENT, amount);
    }
}
