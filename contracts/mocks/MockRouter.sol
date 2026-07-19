// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {IPancakeRouterV2} from '../interfaces/IPancakeRouterV2.sol';
import {MockERC20} from './MockERC20.sol';

contract MockRouter is IPancakeRouterV2 {
    using SafeERC20 for IERC20;

    address public immutable override factory;
    MockERC20 public immutable lpToken;
    mapping(address => mapping(address => uint256)) public rate;

    constructor(address factory_) {
        factory = factory_;
        lpToken = new MockERC20('Mock LP', 'MLP');
    }

    receive() external payable {}

    function setRate(address tokenIn, address tokenOut, uint256 rateWad) external {
        rate[tokenIn][tokenOut] = rateWad;
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i != 0; --i) {
            uint256 rateWad = rate[path[i - 1]][path[i]];
            require(rateWad != 0, 'NO_RATE');
            amounts[i - 1] = (amounts[i] * 1 ether + rateWad - 1) / rateWad;
        }
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override {
        require(block.timestamp <= deadline, 'EXPIRED');
        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];
        uint256 amountOut = amountIn * rate[tokenIn][tokenOut] / 1 ether;
        require(amountOut >= amountOutMin, 'INSUFFICIENT_OUTPUT');

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).mint(to, amountOut);
    }

    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, 'EXPIRED');
        uint256 rateWad = rate[path[0]][path[path.length - 1]];
        uint256 amountIn = (amountOut * 1 ether + rateWad - 1) / rateWad;
        require(amountIn <= amountInMax, 'EXCESSIVE_INPUT');
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        (bool sent, ) = payable(to).call{value: amountOut}('');
        require(sent, 'ETH_TRANSFER_FAILED');

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(block.timestamp <= deadline, 'EXPIRED');
        require(amountADesired >= amountAMin && amountBDesired >= amountBMin, 'SLIPPAGE');

        amountA = amountADesired;
        amountB = amountBDesired;
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        liquidity = amountB;
        lpToken.mint(to, liquidity);
    }
}
