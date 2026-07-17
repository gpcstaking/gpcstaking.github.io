// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPancakePair} from '../interfaces/IPancakePair.sol';

contract MockPair is IPancakePair {
    address public immutable override token0;
    address public immutable override token1;
    uint256 public override price0CumulativeLast;
    uint256 public override price1CumulativeLast;
    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _blockTimestampLast;

    constructor(address token0_, address token1_, uint112 reserve0_, uint112 reserve1_) {
        token0 = token0_;
        token1 = token1_;
        _reserve0 = reserve0_;
        _reserve1 = reserve1_;
        _blockTimestampLast = uint32(block.timestamp);
    }

    function getReserves() external view override returns (uint112, uint112, uint32) {
        return (_reserve0, _reserve1, _blockTimestampLast);
    }

    function setReserves(uint112 reserve0_, uint112 reserve1_) external {
        _reserve0 = reserve0_;
        _reserve1 = reserve1_;
        _blockTimestampLast = uint32(block.timestamp);
    }
}
