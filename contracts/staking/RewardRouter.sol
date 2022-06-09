// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IFlpManager.sol";
import "../access/Governable.sol";

contract RewardRouter is ReentrancyGuard, Governable {
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

    event StakeFxdx(address account, uint256 amount);
    event UnstakeFxdx(address account, uint256 amount);

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
        address _flpManager
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
        _unstakeFxdx(msg.sender, fxdx, _amount);
    }

    function unstakeEsFxdx(uint256 _amount) external nonReentrant {
        _unstakeFxdx(msg.sender, esFxdx, _amount);
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

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
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

        emit StakeFxdx(_account, _amount);
    }

    function _unstakeFxdx(address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedFxdxTracker).stakedAmounts(_account);

        IRewardTracker(feeFxdxTracker).unstakeForAccount(_account, bonusFxdxTracker, _amount, _account);
        IRewardTracker(bonusFxdxTracker).unstakeForAccount(_account, stakedFxdxTracker, _amount, _account);
        IRewardTracker(stakedFxdxTracker).unstakeForAccount(_account, _token, _amount, _account);

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

        emit UnstakeFxdx(_account, _amount);
    }
}
