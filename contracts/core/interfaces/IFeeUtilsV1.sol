// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IFeeUtilsV1 {
    function isInitialized() external view returns (bool);

    function hasDynamicFees() external view returns (bool);
    function rolloverInterval() external view returns (uint256);
    function rolloverRateFactor() external view returns (uint256);
    function stableRolloverRateFactor() external view returns (uint256);
    function cumulativeRolloverRates(address _token) external view returns (uint256);
    function lastRolloverTimes(address _token) external view returns (uint256);

    function liquidationFeeUsd() external view returns (uint256);

    function taxBasisPoints() external view returns (uint256);
    function stableTaxBasisPoints() external view returns (uint256);
    function mintBurnFeeBasisPoints() external view returns (uint256);
    function swapFeeBasisPoints() external view returns (uint256);
    function stableSwapFeeBasisPoints() external view returns (uint256);
    function marginFeeBasisPoints() external view returns (uint256);

    function setRolloverRate(uint256 _rolloverInterval, uint256 _rolloverRateFactor, uint256 _stableRolloverRateFactor) external;

    function setFees(
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd,
        bool _hasDynamicFees
    ) external;
}
