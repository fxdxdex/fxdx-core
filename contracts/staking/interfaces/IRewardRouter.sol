// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IRewardRouter {
    function flpManager() external view returns (address);
    function isLiquidityRouter(address _account) external view returns (bool);
    function setLiquidityRouter(address _requestRouter, bool _isActive) external;
    function mintAndStakeFlpForAccount(address _fundingAccount, address _account, address _token, uint256 _amount, uint256 _minUsdf, uint256 _minFlp) external returns (uint256);
    function unstakeAndRedeemFlpForAccount(address _account, address _tokenOut, uint256 _flpAmount, uint256 _minOut, address _receiver) external returns (uint256);
}
