// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {IGpcPriceOracle} from '../interfaces/IGpcPriceOracle.sol';

contract MockOracle is IGpcPriceOracle {
    uint256 public override price;
    uint256 public override bnbPrice;

    constructor(uint256 gpcPrice_, uint256 bnbPrice_) {
        price = gpcPrice_;
        bnbPrice = bnbPrice_;
    }

    function setPrices(uint256 gpcPrice_, uint256 bnbPrice_) external {
        price = gpcPrice_;
        bnbPrice = bnbPrice_;
    }
}
