// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../access/Governable.sol";
import "../peripherals/interfaces/ITimelock.sol";

contract RewardManager is Governable {

    bool public isInitialized;

    ITimelock public timelock;
    address public rewardRouter;

    address public flpManager;

    address public stakedFxdxTracker;
    address public bonusFxdxTracker;
    address public feeFxdxTracker;

    address public feeFlpTracker;
    address public stakedFlpTracker;

    address public stakedFxdxDistributor;
    address public stakedFlpDistributor;

    address public esFxdx;
    address public bnFxdx;

    address public fxdxVester;
    address public flpVester;

    function initialize(
        ITimelock _timelock,
        address _rewardRouter,
        address _flpManager,
        address _stakedFxdxTracker,
        address _bonusFxdxTracker,
        address _feeFxdxTracker,
        address _feeFlpTracker,
        address _stakedFlpTracker,
        address _stakedFxdxDistributor,
        address _stakedFlpDistributor,
        address _esFxdx,
        address _bnFxdx,
        address _fxdxVester,
        address _flpVester
    ) external onlyGov {
        require(!isInitialized, "RewardManager: already initialized");
        isInitialized = true;

        timelock = _timelock;
        rewardRouter = _rewardRouter;

        flpManager = _flpManager;

        stakedFxdxTracker = _stakedFxdxTracker;
        bonusFxdxTracker = _bonusFxdxTracker;
        feeFxdxTracker = _feeFxdxTracker;

        feeFlpTracker = _feeFlpTracker;
        stakedFlpTracker = _stakedFlpTracker;

        stakedFxdxDistributor = _stakedFxdxDistributor;
        stakedFlpDistributor = _stakedFlpDistributor;

        esFxdx = _esFxdx;
        bnFxdx = _bnFxdx;

        fxdxVester = _fxdxVester;
        flpVester = _flpVester;
    }

    function updateEsFxdxHandlers() external onlyGov {
        timelock.managedSetHandler(esFxdx, rewardRouter, true);

        timelock.managedSetHandler(esFxdx, stakedFxdxDistributor, true);
        timelock.managedSetHandler(esFxdx, stakedFlpDistributor, true);

        timelock.managedSetHandler(esFxdx, stakedFxdxTracker, true);
        timelock.managedSetHandler(esFxdx, stakedFlpTracker, true);

        timelock.managedSetHandler(esFxdx, fxdxVester, true);
        timelock.managedSetHandler(esFxdx, flpVester, true);
    }

    function enableRewardRouter() external onlyGov {
        timelock.managedSetHandler(flpManager, rewardRouter, true);

        timelock.managedSetHandler(stakedFxdxTracker, rewardRouter, true);
        timelock.managedSetHandler(bonusFxdxTracker, rewardRouter, true);
        timelock.managedSetHandler(feeFxdxTracker, rewardRouter, true);

        timelock.managedSetHandler(feeFlpTracker, rewardRouter, true);
        timelock.managedSetHandler(stakedFlpTracker, rewardRouter, true);

        timelock.managedSetHandler(esFxdx, rewardRouter, true);

        timelock.managedSetMinter(bnFxdx, rewardRouter, true);

        timelock.managedSetMinter(esFxdx, fxdxVester, true);
        timelock.managedSetMinter(esFxdx, flpVester, true);

        timelock.managedSetHandler(fxdxVester, rewardRouter, true);
        timelock.managedSetHandler(flpVester, rewardRouter, true);

        timelock.managedSetHandler(feeFxdxTracker, fxdxVester, true);
        timelock.managedSetHandler(stakedFlpTracker, flpVester, true);
    }
}
