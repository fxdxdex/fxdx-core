// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ISwapRouter {
    function swapRequestKeysStart() external returns (uint256);

    function executeSwaps(uint256 _count, address payable _executionFeeReceiver) external;
}
