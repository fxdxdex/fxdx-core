// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "./interfaces/IRouter.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IOrderBook.sol";

import "../peripherals/interfaces/ITimelock.sol";
import "./BasePositionManager.sol";
import "../oracle/interfaces/IFastPriceFeed.sol";

contract PositionManager is BasePositionManager {

    address public orderBook;
    address public fastPriceFeed;
    bool public inLegacyMode;

    bool public shouldValidateIncreaseOrder = true;

    mapping (address => bool) public isOrderKeeper;
    mapping (address => bool) public isPartner;
    mapping (address => bool) public isLiquidator;

    event SetOrderKeeper(address indexed account, bool isActive);
    event SetLiquidator(address indexed account, bool isActive);
    event SetPartner(address account, bool isActive);
    event SetInLegacyMode(bool inLegacyMode);
    event SetShouldValidateIncreaseOrder(bool shouldValidateIncreaseOrder);

    modifier onlyOrderKeeper() {
        require(isOrderKeeper[msg.sender], "PositionManager: forbidden");
        _;
    }

    modifier onlyLiquidator() {
        require(isLiquidator[msg.sender], "PositionManager: forbidden");
        _;
    }

    modifier onlyPartnersOrLegacyMode() {
        require(isPartner[msg.sender] || inLegacyMode, "PositionManager: forbidden");
        _;
    }

    constructor(
        address _vault,
        address _router,
        address _weth,
        uint256 _depositFee,
        address _orderBook
    ) public BasePositionManager(_vault, _router, _weth, _depositFee) {
        orderBook = _orderBook;
    }

    function setFastPriceFeed(address _fastPriceFeed) external onlyAdmin {
        fastPriceFeed = _fastPriceFeed;
    }

    function setOrderKeeper(address _account, bool _isActive) external onlyAdmin {
        isOrderKeeper[_account] = _isActive;
        emit SetOrderKeeper(_account, _isActive);
    }

    function setLiquidator(address _account, bool _isActive) external onlyAdmin {
        isLiquidator[_account] = _isActive;
        emit SetLiquidator(_account, _isActive);
    }

    function setPartner(address _account, bool _isActive) external onlyAdmin {
        isPartner[_account] = _isActive;
        emit SetPartner(_account, _isActive);
    }

    function setInLegacyMode(bool _inLegacyMode) external onlyAdmin {
        inLegacyMode = _inLegacyMode;
        emit SetInLegacyMode(_inLegacyMode);
    }

    function setShouldValidateIncreaseOrder(bool _shouldValidateIncreaseOrder) external onlyAdmin {
        shouldValidateIncreaseOrder = _shouldValidateIncreaseOrder;
        emit SetShouldValidateIncreaseOrder(_shouldValidateIncreaseOrder);
    }

    function increasePosition(
        address[] memory _path,
        address _indexToken,
        uint256 _amountIn,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 1 || _path.length == 2, "PositionManager: invalid _path.length");

        if (_amountIn > 0) {
            if (_path.length == 1) {
                IRouter(router).pluginTransfer(_path[0], msg.sender, address(this), _amountIn);
            } else {
                IRouter(router).pluginTransfer(_path[0], msg.sender, vault, _amountIn);
                _amountIn = _swap(_path, _minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(msg.sender, _path, _amountIn, _indexToken, _isLong, _sizeDelta);
            IERC20(_path[_path.length - 1]).safeTransfer(vault, afterFeeAmount);
        }

        _increasePosition(msg.sender, _path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function increasePositionETH(
        address[] memory _path,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _price
    ) external payable nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 1 || _path.length == 2, "PositionManager: invalid _path.length");
        require(_path[0] == weth, "PositionManager: invalid _path");

        if (msg.value > 0) {
            _transferInETH();
            uint256 _amountIn = msg.value;

            if (_path.length > 1) {
                IERC20(weth).safeTransfer(vault, msg.value);
                _amountIn = _swap(_path, _minOut, address(this));
            }

            uint256 afterFeeAmount = _collectFees(msg.sender, _path, _amountIn, _indexToken, _isLong, _sizeDelta);
            IERC20(_path[_path.length - 1]).safeTransfer(vault, afterFeeAmount);
        }

        _increasePosition(msg.sender, _path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function decreasePosition(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price
    ) external nonReentrant onlyPartnersOrLegacyMode {
        _decreasePosition(msg.sender, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver, _price);
    }

    function decreasePositionETH(
        address _collateralToken,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_collateralToken == weth, "PositionManager: invalid _collateralToken");

        uint256 amountOut = _decreasePosition(msg.sender, _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        _transferOutETH(amountOut, _receiver);
    }

    function decreasePositionAndSwap(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address _receiver,
        uint256 _price,
        uint256 _minOut
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 2, "PositionManager: invalid _path.length");

        uint256 amount = _decreasePosition(msg.sender, _path[0], _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        IERC20(_path[0]).safeTransfer(vault, amount);
        _swap(_path, _minOut, _receiver);
    }

    function decreasePositionAndSwapETH(
        address[] memory _path,
        address _indexToken,
        uint256 _collateralDelta,
        uint256 _sizeDelta,
        bool _isLong,
        address payable _receiver,
        uint256 _price,
        uint256 _minOut
    ) external nonReentrant onlyPartnersOrLegacyMode {
        require(_path.length == 2, "PositionManager: invalid _path.length");
        require(_path[_path.length - 1] == weth, "PositionManager: invalid _path");

        uint256 amount = _decreasePosition(msg.sender, _path[0], _indexToken, _collateralDelta, _sizeDelta, _isLong, address(this), _price);
        IERC20(_path[0]).safeTransfer(vault, amount);
        uint256 amountOut = _swap(_path, _minOut, address(this));
        _transferOutETH(amountOut, _receiver);
    }

    function liquidatePosition(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        address _feeReceiver
    ) external nonReentrant onlyLiquidator {
        address _vault = vault;
        address timelock = IVault(_vault).gov();

        ITimelock(timelock).enableLeverage(_vault);
        IVault(_vault).liquidatePosition(_account, _collateralToken, _indexToken, _isLong, _feeReceiver);
        ITimelock(timelock).disableLeverage(_vault);
    }

    function submitPricesAndLiquidatePosition(
        uint256 _priceBits,
        uint256 _timestamp,
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        address _feeReceiver
    ) external nonReentrant onlyLiquidator {
        if (fastPriceFeed != address(0) && _priceBits > 0) {
            IFastPriceFeed(fastPriceFeed).setPricesWithBits(_priceBits, _timestamp);
        }

        address _vault = vault;
        address timelock = IVault(_vault).gov();

        ITimelock(timelock).enableLeverage(_vault);
        IVault(_vault).liquidatePosition(_account, _collateralToken, _indexToken, _isLong, _feeReceiver);
        ITimelock(timelock).disableLeverage(_vault);
    }

    function executeSwapOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) external onlyOrderKeeper {
        IOrderBook(orderBook).executeSwapOrder(_account, _orderIndex, _feeReceiver);
    }

    function submitPricesAndExecuteSwapOrder(
        uint256 _priceBits,
        uint256 _timestamp,
        address _account,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) external onlyOrderKeeper {
        if (fastPriceFeed != address(0) && _priceBits > 0) {
            IFastPriceFeed(fastPriceFeed).setPricesWithBits(_priceBits, _timestamp);
        }

        IOrderBook(orderBook).executeSwapOrder(_account, _orderIndex, _feeReceiver);
    }

    function executeIncreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) external onlyOrderKeeper {
        _executeIncreaseOrder(_account, _orderIndex, _feeReceiver);
    }

    function submitPricesAndExecuteIncreaseOrder(
        uint256 _priceBits,
        uint256 _timestamp,
        address _account,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) external onlyOrderKeeper {
        if (fastPriceFeed != address(0) && _priceBits > 0) {
            IFastPriceFeed(fastPriceFeed).setPricesWithBits(_priceBits, _timestamp);
        }

        _executeIncreaseOrder(_account, _orderIndex, _feeReceiver);
    }

    function executeDecreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) external onlyOrderKeeper {
        _executeDecreaseOrder(_account, _orderIndex, _feeReceiver);
    }

    function submitPricesAndExecuteDecreaseOrder(
        uint256 _priceBits,
        uint256 _timestamp,
        address _account,
        uint256 _orderIndex,
        address payable _feeReceiver
    ) external onlyOrderKeeper {
        if (fastPriceFeed != address(0) && _priceBits > 0) {
            IFastPriceFeed(fastPriceFeed).setPricesWithBits(_priceBits, _timestamp);
        }

        _executeDecreaseOrder(_account, _orderIndex, _feeReceiver);
    }

    function _executeIncreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) internal {
        (uint256 sizeDelta, address _indexToken) =  _validateIncreaseOrder(_account, _orderIndex);

        address _vault = vault;
        address timelock = IVault(_vault).gov();

        ITimelock(timelock).enableLeverage(_vault);
        IOrderBook(orderBook).executeIncreaseOrder(_account, _orderIndex, _feeReceiver);
        ITimelock(timelock).disableLeverage(_vault);

        _emitIncreasePositionReferral(_account, _indexToken, sizeDelta);
    }

    function _executeDecreaseOrder(address _account, uint256 _orderIndex, address payable _feeReceiver) internal {
        address _vault = vault;
        address timelock = IVault(_vault).gov();

        (
            , // _collateralToken
            , // _collateralDelta
            address _indexToken,
            uint256 _sizeDelta,
            , // _isLong
            , // triggerPrice
            , // triggerAboveThreshold
            // executionFee
        ) = IOrderBook(orderBook).getDecreaseOrder(_account, _orderIndex);

        ITimelock(timelock).enableLeverage(_vault);
        IOrderBook(orderBook).executeDecreaseOrder(_account, _orderIndex, _feeReceiver);
        ITimelock(timelock).disableLeverage(_vault);

        _emitDecreasePositionReferral(_account, _indexToken, _sizeDelta);
    }

    function _validateIncreaseOrder(address _account, uint256 _orderIndex) internal view returns (uint256, address) {
        (
            address _purchaseToken,
            uint256 _purchaseTokenAmount,
            address _collateralToken,
            address _indexToken,
            uint256 _sizeDelta,
            bool _isLong,
            , // triggerPrice
            , // triggerAboveThreshold
            // executionFee
        ) = IOrderBook(orderBook).getIncreaseOrder(_account, _orderIndex);

        if (!shouldValidateIncreaseOrder) { return (_sizeDelta, _indexToken); }

        // shorts are okay
        if (!_isLong) { return (_sizeDelta, _indexToken); }

        // if the position size is not increasing, this is a collateral deposit
        require(_sizeDelta > 0, "PositionManager: long deposit");

        IVault _vault = IVault(vault);
        (uint256 size, uint256 collateral, , , , , , ) = _vault.getPosition(_account, _collateralToken, _indexToken, _isLong);

        // if there is no existing position, do not charge a fee
        if (size == 0) { return (_sizeDelta, _indexToken); }

        uint256 nextSize = size.add(_sizeDelta);
        uint256 collateralDelta = _vault.tokenToUsdMin(_purchaseToken, _purchaseTokenAmount);
        uint256 nextCollateral = collateral.add(collateralDelta);

        uint256 prevLeverage = size.mul(BASIS_POINTS_DIVISOR).div(collateral);
        // allow for a maximum of a increasePositionBufferBps decrease since there might be some swap fees taken from the collateral
        uint256 nextLeverageWithBuffer = nextSize.mul(BASIS_POINTS_DIVISOR + increasePositionBufferBps).div(nextCollateral);

        require(nextLeverageWithBuffer >= prevLeverage, "PositionManager: long leverage decrease");

        return (_sizeDelta, _indexToken);
    }
}
