// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract MockOracleRouter {
    address public immutable factory;

    constructor(address factory_) {
        factory = factory_;
    }
}
