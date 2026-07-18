// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IGpcHistoryRegistry {
    function appendPower(address account, uint256 amount, uint8 kind) external;
    function appendQuota(address account, uint256 amount, uint8 kind) external;
}
