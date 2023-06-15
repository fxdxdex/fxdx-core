// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface ILiquidityReferralStorage {
    function setTierTotalRebate(uint256 _tierId, uint256 _totalRebate) external;
    function setReferrerTier(address _referrer, uint256 _tierId) external;
}
