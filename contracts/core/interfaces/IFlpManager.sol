// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IFlpManager {
    function usdf() external view returns (address);
    function cooldownDuration() external returns (uint256);
    function getAumInUsdf(bool maximise) external view returns (uint256);
    function lastAddedAt(address _account) external returns (uint256);
    function addLiquidity(address _token, uint256 _amount, uint256 _minUsdf, uint256 _minFlp) external returns (uint256);
    function addLiquidityForAccount(address _fundingAccount, address _account, address _token, uint256 _amount, uint256 _minUsdf, uint256 _minFlp) external returns (uint256);
    function removeLiquidity(address _tokenOut, uint256 _flpAmount, uint256 _minOut, address _receiver) external returns (uint256);
    function removeLiquidityForAccount(address _account, address _tokenOut, uint256 _flpAmount, uint256 _minOut, address _receiver) external returns (uint256);
}
