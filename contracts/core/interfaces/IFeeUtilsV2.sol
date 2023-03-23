// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IFeeUtilsV2 {
    function isInitialized() external view returns (bool);

    function hasDynamicFees() external view returns (bool);
    function rolloverInterval() external view returns (uint256);
    function rolloverRateFactors(address _token) external view returns (uint256);
    function cumulativeRolloverRates(address _token) external view returns (uint256);
    function lastRolloverTimes(address _token) external view returns (uint256);

    function liquidationFeeUsd() external view returns (uint256);

    function taxBasisPoints(address _token) external view returns (uint256);
    function mintBurnFeeBasisPoints(address _token) external view returns (uint256);
    function swapFeeBasisPoints(address _token) external view returns (uint256);

    function relativePnlLists(address _token, uint256 index) external view returns (uint256);
    function positionFeeBasisPointsLists(address _token, uint256 index) external view returns (uint256);
    function profitFeeBasisPointsLists(address _token, uint256 index) external view returns (uint256);

    function setRolloverInterval(uint256 _rolloverInterval) external;
    function setLiquidationFeeUsd(uint256 _liquidationFeeUsd) external;
    function setHasDynamicFees(bool _hasDynamicFees) external;

    function setTokenFeeFactors(
        address _token,
        uint256 _taxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _rolloverRateFactor,
        uint256[] memory _relativePnlList,
        uint256[] memory _positionFeeBpsList,
        uint256[] memory _profitFeeBpsList
    ) external;
}
