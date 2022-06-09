// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IVester.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IFlpManager.sol";
import "../access/Governable.sol";

contract RewardRouterV2 is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;

    address public weth;

    address public fxdx;
    address public esFxdx;
    address public bnFxdx;

    address public flp; // FXDX Liquidity Provider token

    address public stakedFxdxTracker;
    address public bonusFxdxTracker;
    address public feeFxdxTracker;

    address public stakedFlpTracker;
    address public feeFlpTracker;

    address public flpManager;

    address public fxdxVester;
    address public flpVester;

    mapping (address => address) public pendingReceivers;

    event StakeFxdx(address account, address token, uint256 amount);
    event UnstakeFxdx(address account, address token, uint256 amount);

    event StakeFlp(address account, uint256 amount);
    event UnstakeFlp(address account, uint256 amount);

    receive() external payable {
        require(msg.sender == weth, "Router: invalid sender");
    }

    function initialize(
        address _weth,
        address _fxdx,
        address _esFxdx,
        address _bnFxdx,
        address _flp,
        address _stakedFxdxTracker,
        address _bonusFxdxTracker,
        address _feeFxdxTracker,
        address _feeFlpTracker,
        address _stakedFlpTracker,
        address _flpManager,
        address _fxdxVester,
        address _flpVester
    ) external onlyGov {
        require(!isInitialized, "RewardRouter: already initialized");
        isInitialized = true;

        weth = _weth;

        fxdx = _fxdx;
        esFxdx = _esFxdx;
        bnFxdx = _bnFxdx;

        flp = _flp;

        stakedFxdxTracker = _stakedFxdxTracker;
        bonusFxdxTracker = _bonusFxdxTracker;
        feeFxdxTracker = _feeFxdxTracker;

        feeFlpTracker = _feeFlpTracker;
        stakedFlpTracker = _stakedFlpTracker;

        flpManager = _flpManager;

        fxdxVester = _fxdxVester;
        flpVester = _flpVester;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function batchStakeFxdxForAccount(address[] memory _accounts, uint256[] memory _amounts) external nonReentrant onlyGov {
        address _fxdx = fxdx;
        for (uint256 i = 0; i < _accounts.length; i++) {
            _stakeFxdx(msg.sender, _accounts[i], _fxdx, _amounts[i]);
        }
    }

    function stakeFxdxForAccount(address _account, uint256 _amount) external nonReentrant onlyGov {
        _stakeFxdx(msg.sender, _account, fxdx, _amount);
    }

    function stakeFxdx(uint256 _amount) external nonReentrant {
        _stakeFxdx(msg.sender, msg.sender, fxdx, _amount);
    }

    function stakeEsFxdx(uint256 _amount) external nonReentrant {
        _stakeFxdx(msg.sender, msg.sender, esFxdx, _amount);
    }

    function unstakeFxdx(uint256 _amount) external nonReentrant {
        _unstakeFxdx(msg.sender, fxdx, _amount, true);
    }

    function unstakeEsFxdx(uint256 _amount) external nonReentrant {
        _unstakeFxdx(msg.sender, esFxdx, _amount, true);
    }

    function mintAndStakeFlp(address _token, uint256 _amount, uint256 _minUsdf, uint256 _minFlp) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");

        address account = msg.sender;
        uint256 flpAmount = IFlpManager(flpManager).addLiquidityForAccount(account, account, _token, _amount, _minUsdf, _minFlp);
        IRewardTracker(feeFlpTracker).stakeForAccount(account, account, flp, flpAmount);
        IRewardTracker(stakedFlpTracker).stakeForAccount(account, account, feeFlpTracker, flpAmount);

        emit StakeFlp(account, flpAmount);

        return flpAmount;
    }

    function mintAndStakeFlpETH(uint256 _minUsdf, uint256 _minFlp) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "RewardRouter: invalid msg.value");

        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).approve(flpManager, msg.value);

        address account = msg.sender;
        uint256 flpAmount = IFlpManager(flpManager).addLiquidityForAccount(address(this), account, weth, msg.value, _minUsdf, _minFlp);

        IRewardTracker(feeFlpTracker).stakeForAccount(account, account, flp, flpAmount);
        IRewardTracker(stakedFlpTracker).stakeForAccount(account, account, feeFlpTracker, flpAmount);

        emit StakeFlp(account, flpAmount);

        return flpAmount;
    }

    function unstakeAndRedeemFlp(address _tokenOut, uint256 _flpAmount, uint256 _minOut, address _receiver) external nonReentrant returns (uint256) {
        require(_flpAmount > 0, "RewardRouter: invalid _flpAmount");

        address account = msg.sender;
        IRewardTracker(stakedFlpTracker).unstakeForAccount(account, feeFlpTracker, _flpAmount, account);
        IRewardTracker(feeFlpTracker).unstakeForAccount(account, flp, _flpAmount, account);
        uint256 amountOut = IFlpManager(flpManager).removeLiquidityForAccount(account, _tokenOut, _flpAmount, _minOut, _receiver);

        emit UnstakeFlp(account, _flpAmount);

        return amountOut;
    }

    function unstakeAndRedeemFlpETH(uint256 _flpAmount, uint256 _minOut, address payable _receiver) external nonReentrant returns (uint256) {
        require(_flpAmount > 0, "RewardRouter: invalid _flpAmount");

        address account = msg.sender;
        IRewardTracker(stakedFlpTracker).unstakeForAccount(account, feeFlpTracker, _flpAmount, account);
        IRewardTracker(feeFlpTracker).unstakeForAccount(account, flp, _flpAmount, account);
        uint256 amountOut = IFlpManager(flpManager).removeLiquidityForAccount(account, weth, _flpAmount, _minOut, address(this));

        IWETH(weth).withdraw(amountOut);

        _receiver.sendValue(amountOut);

        emit UnstakeFlp(account, _flpAmount);

        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeFxdxTracker).claimForAccount(account, account);
        IRewardTracker(feeFlpTracker).claimForAccount(account, account);

        IRewardTracker(stakedFxdxTracker).claimForAccount(account, account);
        IRewardTracker(stakedFlpTracker).claimForAccount(account, account);
    }

    function claimEsFxdx() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(stakedFxdxTracker).claimForAccount(account, account);
        IRewardTracker(stakedFlpTracker).claimForAccount(account, account);
    }

    function claimFees() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeFxdxTracker).claimForAccount(account, account);
        IRewardTracker(feeFlpTracker).claimForAccount(account, account);
    }

    function compound() external nonReentrant {
        _compound(msg.sender);
    }

    function compoundForAccount(address _account) external nonReentrant onlyGov {
        _compound(_account);
    }

    function handleRewards(
        bool _shouldClaimFxdx,
        bool _shouldStakeFxdx,
        bool _shouldClaimEsFxdx,
        bool _shouldStakeEsFxdx,
        bool _shouldStakeMultiplierPoints,
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external nonReentrant {
        address account = msg.sender;

        uint256 fxdxAmount = 0;
        if (_shouldClaimFxdx) {
            uint256 fxdxAmount0 = IVester(fxdxVester).claimForAccount(account, account);
            uint256 fxdxAmount1 = IVester(flpVester).claimForAccount(account, account);
            fxdxAmount = fxdxAmount0.add(fxdxAmount1);
        }

        if (_shouldStakeFxdx && fxdxAmount > 0) {
            _stakeFxdx(account, account, fxdx, fxdxAmount);
        }

        uint256 esFxdxAmount = 0;
        if (_shouldClaimEsFxdx) {
            uint256 esFxdxAmount0 = IRewardTracker(stakedFxdxTracker).claimForAccount(account, account);
            uint256 esFxdxAmount1 = IRewardTracker(stakedFlpTracker).claimForAccount(account, account);
            esFxdxAmount = esFxdxAmount0.add(esFxdxAmount1);
        }

        if (_shouldStakeEsFxdx && esFxdxAmount > 0) {
            _stakeFxdx(account, account, esFxdx, esFxdxAmount);
        }

        if (_shouldStakeMultiplierPoints) {
            uint256 bnFxdxAmount = IRewardTracker(bonusFxdxTracker).claimForAccount(account, account);
            if (bnFxdxAmount > 0) {
                IRewardTracker(feeFxdxTracker).stakeForAccount(account, account, bnFxdx, bnFxdxAmount);
            }
        }

        if (_shouldClaimWeth) {
            if (_shouldConvertWethToEth) {
                uint256 weth0 = IRewardTracker(feeFxdxTracker).claimForAccount(account, address(this));
                uint256 weth1 = IRewardTracker(feeFlpTracker).claimForAccount(account, address(this));

                uint256 wethAmount = weth0.add(weth1);
                IWETH(weth).withdraw(wethAmount);

                payable(account).sendValue(wethAmount);
            } else {
                IRewardTracker(feeFxdxTracker).claimForAccount(account, account);
                IRewardTracker(feeFlpTracker).claimForAccount(account, account);
            }
        }
    }

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    function signalTransfer(address _receiver) external nonReentrant {
        require(IERC20(fxdxVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(flpVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");

        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        require(IERC20(fxdxVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(flpVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");

        address receiver = msg.sender;
        require(pendingReceivers[_sender] == receiver, "RewardRouter: transfer not signalled");
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);
        _compound(_sender);

        uint256 stakedFxdx = IRewardTracker(stakedFxdxTracker).depositBalances(_sender, fxdx);
        if (stakedFxdx > 0) {
            _unstakeFxdx(_sender, fxdx, stakedFxdx, false);
            _stakeFxdx(_sender, receiver, fxdx, stakedFxdx);
        }

        uint256 stakedEsFxdx = IRewardTracker(stakedFxdxTracker).depositBalances(_sender, esFxdx);
        if (stakedEsFxdx > 0) {
            _unstakeFxdx(_sender, esFxdx, stakedEsFxdx, false);
            _stakeFxdx(_sender, receiver, esFxdx, stakedEsFxdx);
        }

        uint256 stakedBnFxdx = IRewardTracker(feeFxdxTracker).depositBalances(_sender, bnFxdx);
        if (stakedBnFxdx > 0) {
            IRewardTracker(feeFxdxTracker).unstakeForAccount(_sender, bnFxdx, stakedBnFxdx, _sender);
            IRewardTracker(feeFxdxTracker).stakeForAccount(_sender, receiver, bnFxdx, stakedBnFxdx);
        }

        uint256 esFxdxBalance = IERC20(esFxdx).balanceOf(_sender);
        if (esFxdxBalance > 0) {
            IERC20(esFxdx).transferFrom(_sender, receiver, esFxdxBalance);
        }

        uint256 flpAmount = IRewardTracker(feeFlpTracker).depositBalances(_sender, flp);
        if (flpAmount > 0) {
            IRewardTracker(stakedFlpTracker).unstakeForAccount(_sender, feeFlpTracker, flpAmount, _sender);
            IRewardTracker(feeFlpTracker).unstakeForAccount(_sender, flp, flpAmount, _sender);

            IRewardTracker(feeFlpTracker).stakeForAccount(_sender, receiver, flp, flpAmount);
            IRewardTracker(stakedFlpTracker).stakeForAccount(receiver, receiver, feeFlpTracker, flpAmount);
        }

        IVester(fxdxVester).transferStakeValues(_sender, receiver);
        IVester(flpVester).transferStakeValues(_sender, receiver);
    }

    function _validateReceiver(address _receiver) private view {
        require(IRewardTracker(stakedFxdxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedFxdxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(stakedFxdxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedFxdxTracker.cumulativeRewards > 0");

        require(IRewardTracker(bonusFxdxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: bonusFxdxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(bonusFxdxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: bonusFxdxTracker.cumulativeRewards > 0");

        require(IRewardTracker(feeFxdxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeFxdxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(feeFxdxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeFxdxTracker.cumulativeRewards > 0");

        require(IVester(fxdxVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: fxdxVester.transferredAverageStakedAmounts > 0");
        require(IVester(fxdxVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: fxdxVester.transferredCumulativeRewards > 0");

        require(IRewardTracker(stakedFlpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedFlpTracker.averageStakedAmounts > 0");
        require(IRewardTracker(stakedFlpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedFlpTracker.cumulativeRewards > 0");

        require(IRewardTracker(feeFlpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeFlpTracker.averageStakedAmounts > 0");
        require(IRewardTracker(feeFlpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeFlpTracker.cumulativeRewards > 0");

        require(IVester(flpVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: fxdxVester.transferredAverageStakedAmounts > 0");
        require(IVester(flpVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: fxdxVester.transferredCumulativeRewards > 0");

        require(IERC20(fxdxVester).balanceOf(_receiver) == 0, "RewardRouter: fxdxVester.balance > 0");
        require(IERC20(flpVester).balanceOf(_receiver) == 0, "RewardRouter: flpVester.balance > 0");
    }

    function _compound(address _account) private {
        _compoundFxdx(_account);
        _compoundFlp(_account);
    }

    function _compoundFxdx(address _account) private {
        uint256 esFxdxAmount = IRewardTracker(stakedFxdxTracker).claimForAccount(_account, _account);
        if (esFxdxAmount > 0) {
            _stakeFxdx(_account, _account, esFxdx, esFxdxAmount);
        }

        uint256 bnFxdxAmount = IRewardTracker(bonusFxdxTracker).claimForAccount(_account, _account);
        if (bnFxdxAmount > 0) {
            IRewardTracker(feeFxdxTracker).stakeForAccount(_account, _account, bnFxdx, bnFxdxAmount);
        }
    }

    function _compoundFlp(address _account) private {
        uint256 esFxdxAmount = IRewardTracker(stakedFlpTracker).claimForAccount(_account, _account);
        if (esFxdxAmount > 0) {
            _stakeFxdx(_account, _account, esFxdx, esFxdxAmount);
        }
    }

    function _stakeFxdx(address _fundingAccount, address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        IRewardTracker(stakedFxdxTracker).stakeForAccount(_fundingAccount, _account, _token, _amount);
        IRewardTracker(bonusFxdxTracker).stakeForAccount(_account, _account, stakedFxdxTracker, _amount);
        IRewardTracker(feeFxdxTracker).stakeForAccount(_account, _account, bonusFxdxTracker, _amount);

        emit StakeFxdx(_account, _token, _amount);
    }

    function _unstakeFxdx(address _account, address _token, uint256 _amount, bool _shouldReduceBnFxdx) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedFxdxTracker).stakedAmounts(_account);

        IRewardTracker(feeFxdxTracker).unstakeForAccount(_account, bonusFxdxTracker, _amount, _account);
        IRewardTracker(bonusFxdxTracker).unstakeForAccount(_account, stakedFxdxTracker, _amount, _account);
        IRewardTracker(stakedFxdxTracker).unstakeForAccount(_account, _token, _amount, _account);

        if (_shouldReduceBnFxdx) {
            uint256 bnFxdxAmount = IRewardTracker(bonusFxdxTracker).claimForAccount(_account, _account);
            if (bnFxdxAmount > 0) {
                IRewardTracker(feeFxdxTracker).stakeForAccount(_account, _account, bnFxdx, bnFxdxAmount);
            }

            uint256 stakedBnFxdx = IRewardTracker(feeFxdxTracker).depositBalances(_account, bnFxdx);
            if (stakedBnFxdx > 0) {
                uint256 reductionAmount = stakedBnFxdx.mul(_amount).div(balance);
                IRewardTracker(feeFxdxTracker).unstakeForAccount(_account, bnFxdx, reductionAmount, _account);
                IMintable(bnFxdx).burn(_account, reductionAmount);
            }
        }

        emit UnstakeFxdx(_account, _token, _amount);
    }
}
