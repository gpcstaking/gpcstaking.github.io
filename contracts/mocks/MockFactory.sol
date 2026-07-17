// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IPancakeFactory} from '../interfaces/IPancakeFactory.sol';

contract MockFactory is IPancakeFactory {
    mapping(address => mapping(address => address)) private _pairs;

    function setPair(address tokenA, address tokenB, address pair) external {
        _pairs[tokenA][tokenB] = pair;
        _pairs[tokenB][tokenA] = pair;
    }

    function getPair(address tokenA, address tokenB) external view override returns (address) {
        return _pairs[tokenA][tokenB];
    }
}
