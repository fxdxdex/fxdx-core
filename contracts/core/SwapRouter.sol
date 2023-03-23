// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../tokens/interfaces/IWETH.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/Address.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IRouter.sol";
import "./interfaces/IVault.sol";
import "./interfaces/ISwapRouter.sol";

import "../access/Governable.sol";
import "../peripherals/interfaces/ITimelock.sol";
import "./BaseRequestRouter.sol";

contract SwapRouter is ISwapRouter, BaseRequestRouter {

    struct SwapRequest {
        address account;
        address[] path;
        uint256 amountIn;
        uint256 minOut;
        address receiver;
        uint256 acceptableRatio;
        uint256 executionFee;
        uint256 blockNumber;
        uint256 blockTime;
        bool isETHIn;
        bool isETHOut;
    }

    bytes32[] public swapRequestKeys;

    uint256 public override swapRequestKeysStart;

    mapping (address => uint256) public swapsIndex;
    mapping (bytes32 => SwapRequest) public swapRequests;

    event CreateSwap(
        address indexed account,
        address[] path,
        uint256 amountIn,
        uint256 minOut,
        address receiver,
        uint256 acceptableRatio,
        uint256 executionFee,
        uint256 index,
        uint256 blockNumber,
        uint256 blockTime
    );

    event ExecuteSwap(
        address indexed account,
        address[] path,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minOut,
        address receiver,
        uint256 acceptableRatio,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event CancelSwap(
        address indexed account,
        address[] path,
        uint256 amountIn,
        uint256 minOut,
        address receiver,
        uint256 acceptableRatio,
        uint256 executionFee,
        uint256 blockGap,
        uint256 timeGap
    );

    event SetRequestKeysStartValue(uint256 swapRequestKeysStart);

    constructor(
        address _vault,
        address _router,
        address _weth,
        uint256 _minExecutionFee
    ) public BaseRequestRouter(_vault, _router, _weth, _minExecutionFee) {}

    function setRequestKeysStartValue(uint256 _swapRequestKeysStart) external onlyAdmin {
        swapRequestKeysStart = _swapRequestKeysStart;

        emit SetRequestKeysStartValue(_swapRequestKeysStart);
    }

    function executeSwaps(uint256 _endIndex, address payable _executionFeeReceiver) external override onlyRequestKeeper {
        uint256 index = swapRequestKeysStart;
        uint256 length = swapRequestKeys.length;

        if (index >= length) { return; }

        if (_endIndex > length) {
            _endIndex = length;
        }

        while (index < _endIndex) {
            bytes32 key = swapRequestKeys[index];

            // if the request was executed then delete the key from the array
            // if the request was not executed then break from the loop, this can happen if the
            // minimum number of blocks has not yet passed
            // an error could be thrown if the request is too old or if the slippage is
            // higher than what the user specified, or if there is insufficient liquidity for the swap
            // in case an error was thrown, cancel the request
            try this.executeSwap(key, _executionFeeReceiver) returns (bool _wasExecuted) {
                if (!_wasExecuted) { break; }
            } catch {
                // wrap this call in a try catch to prevent invalid cancels from blocking the loop
                try this.cancelSwap(key, _executionFeeReceiver) returns (bool _wasCancelled) {
                    if (!_wasCancelled) { break; }
                } catch {}
            }

            delete swapRequestKeys[index];
            index++;
        }

        swapRequestKeysStart = index;
    }

    function createSwap(
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        address _receiver,
        uint256 _acceptableRatio,
        uint256 _executionFee,
        bool _isETHOut
    ) public payable {
        require(_executionFee >= minExecutionFee, "SwapRouter: invalid executionFee");
        require(msg.value == _executionFee, "SwapRouter: invalid msg.value");
        require(_path.length == 2, "SwapRouter: invalid _path length");
        require(_amountIn > 0, "SwapRouter: invalid amountIn");

        if (_isETHOut) {
            require(_path[_path.length - 1] == weth, "SwapRouter: invalid _path");
        }

        _transferInETH();

        IRouter(router).pluginTransfer(_path[0], msg.sender, address(this), _amountIn);

        _createSwap(
            msg.sender,
            _path,
            _amountIn,
            _minOut,
            _receiver,
            _acceptableRatio,
            _executionFee,
            false,
            _isETHOut
        );
    }

    function createSwapETHToTokens(
        address[] memory _path,
        uint256 _minOut,
        address _receiver,
        uint256 _acceptableRatio,
        uint256 _executionFee
    ) external payable {
        require(_executionFee >= minExecutionFee, "SwapRouter: invalid executionFee");
        require(msg.value >= _executionFee, "SwapRouter: invalid msg.value");
        require(_path.length == 2, "SwapRouter: invalid _path length");
        require(_path[0] == weth, "SwapRouter: invalid _path");

        _transferInETH();

        uint256 amountIn = msg.value.sub(_executionFee);

        require(amountIn > 0, "SwapRouter: invalid amountIn");

        _createSwap(
            msg.sender,
            _path,
            amountIn,
            _minOut,
            _receiver,
            _acceptableRatio,
            _executionFee,
            true,
            false
        );
    }

    function getRequestQueueLengths() external view returns (uint256, uint256) {
        return (
            swapRequestKeysStart,
            swapRequestKeys.length
        );
    }

    function getSwapRequestPath(bytes32 _key) public view returns (address[] memory) {
        SwapRequest memory request = swapRequests[_key];
        return request.path;
    }

    function executeSwap(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        SwapRequest memory request = swapRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeSwaps loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldExecute = _validateExecution(request.blockNumber, request.blockTime, request.account);
        if (!shouldExecute) { return false; }

        uint256 ratio = IVault(vault).getMinPrice(request.path[0]).mul(PRICE_PRECISION).div(IVault(vault).getMaxPrice(request.path[1]));

        require(ratio >= request.acceptableRatio, "SwapRouter: price ratio lower than limit");

        delete swapRequests[_key];

        IERC20(request.path[0]).safeTransfer(vault, request.amountIn);
        uint256 amountOut = _swap(request.path, request.minOut, address(this));

        if (request.isETHOut) {
           _transferOutETHWithGasLimit(amountOut, payable(request.receiver));
        } else {
           IERC20(request.path[request.path.length - 1]).safeTransfer(request.receiver, amountOut);
        }

       _transferOutETH(request.executionFee, _executionFeeReceiver);

        emit ExecuteSwap(
            request.account,
            request.path,
            request.amountIn,
            amountOut,
            request.minOut,
            request.receiver,
            request.acceptableRatio,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function cancelSwap(bytes32 _key, address payable _executionFeeReceiver) public nonReentrant returns (bool) {
        SwapRequest memory request = swapRequests[_key];
        // if the request was already executed or cancelled, return true so that the executeSwaps loop will continue executing the next request
        if (request.account == address(0)) { return true; }

        bool shouldCancel = _validateCancellation(request.blockNumber, request.blockTime, request.account);
        if (!shouldCancel) { return false; }

        delete swapRequests[_key];

        if (request.isETHIn) {
            _transferOutETHWithGasLimit(request.amountIn, payable(request.account));
        } else {
            IERC20(request.path[0]).safeTransfer(request.account, request.amountIn);
        }

       _transferOutETH(request.executionFee, _executionFeeReceiver);

        emit CancelSwap(
            request.account,
            request.path,
            request.amountIn,
            request.minOut,
            request.receiver,
            request.acceptableRatio,
            request.executionFee,
            block.number.sub(request.blockNumber),
            block.timestamp.sub(request.blockTime)
        );

        return true;
    }

    function _createSwap(
        address _account,
        address[] memory _path,
        uint256 _amountIn,
        uint256 _minOut,
        address _receiver,
        uint256 _acceptableRatio,
        uint256 _executionFee,
        bool _isETHIn,
        bool _isETHOut
    ) internal {
        uint256 index = swapsIndex[_account].add(1);
        swapsIndex[_account] = index;

        SwapRequest memory request = SwapRequest(
            _account,
            _path,
            _amountIn,
            _minOut,
            _receiver,
            _acceptableRatio,
            _executionFee,
            block.number,
            block.timestamp,
            _isETHIn,
            _isETHOut
        );

        bytes32 key = getRequestKey(_account, index);
        swapRequests[key] = request;

        swapRequestKeys.push(key);

        emit CreateSwap(
            _account,
            _path,
            _amountIn,
            _minOut,
            _receiver,
            _acceptableRatio,
            _executionFee,
            index,
            block.number,
            block.timestamp
        );
    }

    function _swap(address[] memory _path, uint256 _minOut, address _receiver) internal returns (uint256) {
        if (_path.length == 2) {
            return _vaultSwap(_path[0], _path[1], _minOut, _receiver);
        }
        revert("SwapRouter: invalid _path.length");
    }

    function _vaultSwap(address _tokenIn, address _tokenOut, uint256 _minOut, address _receiver) internal returns (uint256) {
        address timelock = IVault(vault).gov();
        ITimelock(timelock).activateFeeUtils(vault);
        uint256 amountOut = IVault(vault).swap(_tokenIn, _tokenOut, _receiver);
        ITimelock(timelock).deactivateFeeUtils(vault);

        require(amountOut >= _minOut, "SwapRouter: insufficient amountOut");
        return amountOut;
    }
}
