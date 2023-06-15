// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../libraries/token/IERC20.sol";
import "./interfaces/IRouter.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ILiquidityRouter.sol";

import "../staking/interfaces/IRewardRouter.sol";
import "../peripherals/interfaces/ITimelock.sol";
import "../referrals/interfaces/IReferralStorage.sol";
import "./BaseRequestRouter.sol";

contract LiquidityRouter is BaseRequestRouter, ILiquidityRouter {

    struct AddLiquidityRequest {
        address account;
        address token;
        uint256 amountIn;
        uint256 minUsdf;
        uint256 minFlp;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
        bool isETHIn;
    }

    struct RemoveLiquidityRequest {
        address account;
        address tokenOut;
        uint256 flpAmount;
        uint256 minOut;
        address receiver;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
        bool isETHOut;
    }

    address public rewardRouter;
    address public referralStorage;

    bytes32[] public addLiquidityRequestKeys;
    bytes32[] public removeLiquidityRequestKeys;

    uint256 public override addLiquidityRequestKeysStart;
    uint256 public override removeLiquidityRequestKeysStart;

    mapping (address => uint256) public addLiquiditiesIndex;
    mapping (bytes32 => AddLiquidityRequest) public addLiquidityRequests;

    mapping (address => uint256) public removeLiquiditiesIndex;
    mapping (bytes32 => RemoveLiquidityRequest) public removeLiquidityRequests;

    event SetReferralStorage(address referralStorage);

    event CreateAddLiquidity(
        address indexed account,
        address token,
        uint256 amountIn,
        uint256 minUsdf,
        uint256 minFlp,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 index,
        uint256 blockNumber,
        uint256 blockTime
    );

    event ExecuteAddLiquidity(
        address indexed account,
        address token,
        uint256 amountIn,
        uint256 minUsdf,
        uint256 minFlp,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelAddLiquidity(
        address indexed account,
        address token,
        uint256 amountIn,
        uint256 minUsdf,
        uint256 minFlp,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CreateRemoveLiquidity(
        address indexed account,
        address tokenOut,
        uint256 flpAmount,
        uint256 minOut,
        address receiver,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 index,
        uint256 blockNumber,
        uint256 blockTime
    );

    event ExecuteRemoveLiquidity(
        address indexed account,
        address tokenOut,
        uint256 flpAmount,
        uint256 minOut,
        address receiver,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelRemoveLiquidity(
        address indexed account,
        address tokenOut,
        uint256 flpAmount,
        uint256 minOut,
        address receiver,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event SetRequestKeysStartValues(
        uint256 addLiquidityRequestKeysStart,
        uint256 removeLiquidityRequestKeysStart
    );

    event AddLiquidityReferral(
        address account,
        bytes32 referralCode,
        address referrer
    );

    constructor(
        address _vault,
        address _router,
        address _rewardRouter,
        address _weth,
        uint256 _minExecutionFee
    ) public BaseRequestRouter(_vault, _router, _weth, _minExecutionFee) {
        rewardRouter = _rewardRouter;
    }

    function setReferralStorage(address _referralStorage) external onlyAdmin {
        referralStorage = _referralStorage;
        emit SetReferralStorage(_referralStorage);
    }

    function setRequestKeysStartValues(
        uint256 _addLiquidityRequestKeysStart,
        uint256 _removeLiquidityRequestKeysStart
    ) external onlyAdmin {
        addLiquidityRequestKeysStart = _addLiquidityRequestKeysStart;
        removeLiquidityRequestKeysStart = _removeLiquidityRequestKeysStart;

        emit SetRequestKeysStartValues(
            _addLiquidityRequestKeysStart,
            _removeLiquidityRequestKeysStart
        );
    }

    function executeAddLiquidities(uint256 _endIndex, address payable _executionFeeReceiver) external override onlyRequestKeeper {
        uint256 index = addLiquidityRequestKeysStart;
        uint256 length = addLiquidityRequestKeys.length;

        if (index >= length) { return; }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = addLiquidityRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old or if the slippage is
            // higher than what the user specified, or if liquidity limit reaches
            // in case an error was thrown, cancel the request
            try this.executeAddLiquidity(key, _executionFeeReceiver) returns (bool _wasExecuted) {
                if (!_wasExecuted) { break; }
            } catch {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelAddLiquidity(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            }

            delete addLiquidityRequestKeys[index];
            index++;
        }

        addLiquidityRequestKeysStart = index;
    }

    function executeRemoveLiquidities(uint256 _endIndex, address payable _executionFeeReceiver) external override onlyRequestKeeper {
        uint256 index = removeLiquidityRequestKeysStart;
        uint256 length = removeLiquidityRequestKeys.length;

        if (index >= length) { return; }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = removeLiquidityRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old
            // in case an error was thrown, cancel the request
            try this.executeRemoveLiquidity(key, _executionFeeReceiver) returns (bool _wasExecuted) {
                if (!_wasExecuted) { break; }
            } catch {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelRemoveLiquidity(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            }

            delete removeLiquidityRequestKeys[index];
            index++;
        }

        removeLiquidityRequestKeysStart = index;
    }

    function createAddLiquidity(
        address _token,
        uint256 _amountIn,
        uint256 _minUsdf,
        uint256 _minFlp,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode
    ) public payable {
        require(_executionFee >= minExecutionFee, "LiquidityRouter: invalid executionFee");
        require(msg.value == _executionFee, "LiquidityRouter: invalid msg.value");
        require(_amountIn > 0, "LiquidityRouter: invalid _amountIn");

        _transferInETH();
        _setTraderReferralCode(_referralCode);

        IRouter(router).pluginTransfer(_token, msg.sender, address(this), _amountIn);

        _createAddLiquidity(
            msg.sender,
            _token,
            _amountIn,
            _minUsdf,
            _minFlp,
            _acceptablePrice,
            _executionFee,
            false
        );
    }

    function createAddLiquidityETH(
        uint256 _minUsdf,
        uint256 _minFlp,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bytes32 _referralCode
    ) external payable {
        require(_executionFee >= minExecutionFee, "LiquidityRouter: invalid executionFee");
        require(msg.value >= _executionFee, "LiquidityRouter: invalid msg.value");

        _transferInETH();
        _setTraderReferralCode(_referralCode);

        uint256 amountIn = msg.value.sub(_executionFee);

        require(amountIn > 0, "LiquidityRouter: invalid amountIn");

        _createAddLiquidity(
            msg.sender,
            weth,
            amountIn,
            _minUsdf,
            _minFlp,
            _acceptablePrice,
            _executionFee,
            true
        );
    }

    function createRemoveLiquidity(
        address _tokenOut,
        uint256 _flpAmount,
        uint256 _minOut,
        address _receiver,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bool _isETHOut
    ) public payable {
        require(_executionFee >= minExecutionFee, "LiquidityRouter: invalid executionFee");
        require(msg.value == _executionFee, "LiquidityRouter: invalid msg.value");
        if (_isETHOut) {
            require(_tokenOut == weth, "LiquidityRouter: invalid _path");
        }

        _transferInETH();

        _createRemoveLiquidity(
            msg.sender,
            _tokenOut,
            _flpAmount,
            _minOut,
            _receiver,
            _acceptablePrice,
            _executionFee,
            _isETHOut
        );
    }

    function getRequestQueueLengths() external view returns (uint256, uint256, uint256, uint256) {
        return (
            addLiquidityRequestKeysStart,
            addLiquidityRequestKeys.length,
            removeLiquidityRequestKeysStart,
            removeLiquidityRequestKeys.length
        );
    }

    function executeAddLiquidity(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        AddLiquidityRequest memory request = addLiquidityRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeAddLiquidities loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldExecute = _validateExecution(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) { return false; }

        require(IVault(vault).getMinPrice(request.token) >= request.acceptablePrice, "LiquidityRouter: mark price lower than limit");

        delete addLiquidityRequests[_key];

        IERC20(request.token).approve(IRewardRouter(rewardRouter).flpManager(), request.amountIn);

        address timelock = IVault(vault).gov();
        ITimelock(timelock).activateFeeUtils(vault);

        IRewardRouter(rewardRouter).mintAndStakeFlpForAccount(
            address(this),
            request.account,
            request.token,
            request.amountIn,
            request.minUsdf,
            request.minFlp
        );
        ITimelock(timelock).deactivateFeeUtils(vault);

        _transferOutETH(request.executionFee, _executionFeeReceiver);

        emit ExecuteAddLiquidity(
            request.account,
            request.token,
            request.amountIn,
            request.minUsdf,
            request.minFlp,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        _emitAddLiquidityReferral(request.account);

        return true;
    }

    function cancelAddLiquidity(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        AddLiquidityRequest memory request = addLiquidityRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeAddLiquidities loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldCancel = _validateCancellation(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) { return false; }

        delete addLiquidityRequests[_key];

        if (request.isETHIn) {
            _transferOutETHWithGasLimit(request.amountIn, payable(request.account));
        } else {
            IERC20(request.token).safeTransfer(request.account, request.amountIn);
        }

       _transferOutETH(request.executionFee, _executionFeeReceiver);

        emit CancelAddLiquidity(
            request.account,
            request.token,
            request.amountIn,
            request.minUsdf,
            request.minFlp,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function executeRemoveLiquidity(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        RemoveLiquidityRequest memory request = removeLiquidityRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeRemoveLiquidities loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldExecute = _validateExecution(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) { return false; }

        require(IVault(vault).getMaxPrice(request.tokenOut) <= request.acceptablePrice, "LiquidityRouter: mark price higher than limit");

        delete removeLiquidityRequests[_key];

        address timelock = IVault(vault).gov();
        ITimelock(timelock).activateFeeUtils(vault);
        uint256 amountOut = IRewardRouter(rewardRouter).unstakeAndRedeemFlpForAccount(
            request.account,
            request.tokenOut,
            request.flpAmount,
            request.minOut,
            address(this)
        );
        ITimelock(timelock).deactivateFeeUtils(vault);

        if (request.isETHOut) {
           _transferOutETHWithGasLimit(amountOut, payable(request.receiver));
        } else {
           IERC20(request.tokenOut).safeTransfer(request.receiver, amountOut);
        }

       _transferOutETH(request.executionFee, _executionFeeReceiver);

        emit ExecuteRemoveLiquidity(
            request.account,
            request.tokenOut,
            request.flpAmount,
            request.minOut,
            request.receiver,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function cancelRemoveLiquidity(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        RemoveLiquidityRequest memory request = removeLiquidityRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeRemoveLiquidities loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldCancel = _validateCancellation(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) { return false; }

        delete removeLiquidityRequests[_key];

       _transferOutETH(request.executionFee, _executionFeeReceiver);

        emit CancelRemoveLiquidity(
            request.account,
            request.tokenOut,
            request.flpAmount,
            request.minOut,
            request.receiver,
            request.acceptablePrice,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function _createAddLiquidity(
        address _account,
        address _token,
        uint256 _amountIn,
        uint256 _minUsdf,
        uint256 _minFlp,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bool _isETHIn
    ) internal {
        uint256 index = addLiquiditiesIndex[_account].add(1);
        addLiquiditiesIndex[_account] = index;

        AddLiquidityRequest memory request = AddLiquidityRequest(
            _account,
            _token,
            _amountIn,
            _minUsdf,
            _minFlp,
            _acceptablePrice,
            _executionFee,
            block.number,
            block.timestamp,
            _isETHIn
        );

        bytes32 key = getRequestKey(_account, index);
        addLiquidityRequests[key] = request;

        addLiquidityRequestKeys.push(key);

        emit CreateAddLiquidity(
            _account,
            _token,
            _amountIn,
            _minUsdf,
            _minFlp,
            _acceptablePrice,
            _executionFee,
            index,
            block.number,
            block.timestamp
        );
    }

    function _createRemoveLiquidity(
        address _account,
        address _tokenOut,
        uint256 _flpAmount,
        uint256 _minOut,
        address _receiver,
        uint256 _acceptablePrice,
        uint256 _executionFee,
        bool _isETHOut
    ) internal {
        uint256 index = removeLiquiditiesIndex[_account].add(1);
        removeLiquiditiesIndex[_account] = index;

        RemoveLiquidityRequest memory request = RemoveLiquidityRequest(
            _account,
            _tokenOut,
            _flpAmount,
            _minOut,
            _receiver,
            _acceptablePrice,
            _executionFee,
            block.number,
            block.timestamp,
            _isETHOut
        );

        bytes32 key = getRequestKey(_account, index);
        removeLiquidityRequests[key] = request;

        removeLiquidityRequestKeys.push(key);

        emit CreateRemoveLiquidity(
            _account,
            _tokenOut,
            _flpAmount,
            _minOut,
            _receiver,
            _acceptablePrice,
            _executionFee,
            index,
            block.number,
            block.timestamp
        );
    }

    function _setTraderReferralCode(bytes32 _referralCode) internal {
        if (_referralCode != bytes32(0) && referralStorage != address(0)) {
            IReferralStorage(referralStorage).setTraderReferralCode(msg.sender, _referralCode);
        }
    }

    function _emitAddLiquidityReferral(address _account) internal {
        address _referralStorage = referralStorage;
        if (_referralStorage == address(0)) {
            return;
        }

        (bytes32 referralCode, address referrer) = IReferralStorage(_referralStorage).getTraderReferralInfo(_account);

        if (referralCode == bytes32(0)) {
            return;
        }

        emit AddLiquidityReferral(
            _account,
            referralCode,
            referrer
        );
    }
}
