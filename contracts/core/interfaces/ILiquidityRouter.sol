// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ILiquidityRouter {
    function addLiquidityRequestKeysStart() external view returns (uint256);
    function removeLiquidityRequestKeysStart() external view returns (uint256);

    function executeAddLiquidities(uint256 _count, address payable _executionFeeReceiver) external;
    function executeRemoveLiquidities(uint256 _count, address payable _executionFeeReceiver) external;
}
