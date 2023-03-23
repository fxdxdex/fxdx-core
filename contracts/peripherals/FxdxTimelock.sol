// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/ITimelockTarget.sol";
import "./interfaces/IFxdxTimelock.sol";
import "./interfaces/IHandlerTarget.sol";
import "../access/interfaces/IAdmin.sol";
import "../core/interfaces/IVault.sol";
import "../core/interfaces/IVaultUtils.sol";
import "../core/interfaces/IFeeUtils.sol";
import "../core/interfaces/IFeeUtilsV1.sol";
import "../core/interfaces/IFeeUtilsV2.sol";
import "../core/interfaces/IVaultPriceFeed.sol";
import "../core/interfaces/IRouter.sol";
import "../tokens/interfaces/IYieldToken.sol";
import "../tokens/interfaces/IBaseToken.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IUSDF.sol";
import "../staking/interfaces/IVester.sol";

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

contract FxdxTimelock is IFxdxTimelock {
    using SafeMath for uint256;

    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MAX_BUFFER = 7 days;
    uint256 public constant MAX_FEE_BASIS_POINTS = 300; // 3%
    uint256 public constant MAX_ROLLOVER_RATE_FACTOR = 200; // 0.02%
    uint256 public constant MAX_LEVERAGE_VALIDATION = 500000; // 50x

    uint256 public buffer;
    uint256 public longBuffer;
    address public admin;

    address public tokenManager;
    address public rewardManager;
    address public mintReceiver;
    uint256 public maxTokenSupply;

    mapping (bytes32 => uint256) public pendingActions;
    mapping (address => bool) public excludedTokens;

    mapping (address => bool) public isHandler;

    event SignalPendingAction(bytes32 action);
    event SignalApprove(address token, address spender, uint256 amount, bytes32 action);
    event SignalWithdrawToken(address target, address token, address receiver, uint256 amount, bytes32 action);
    event SignalMint(address token, address receiver, uint256 amount, bytes32 action);
    event SignalSetGov(address target, address gov, bytes32 action);
    event SignalSetPriceFeed(address vault, address priceFeed, bytes32 action);
    event SignalAddPlugin(address router, address plugin, bytes32 action);
    event SignalRedeemUsdf(address vault, address token, uint256 amount, bytes32 action);
    event SignalVaultSetTokenConfig(
        address vault,
        address token,
        uint256 tokenDecimals,
        uint256 tokenWeight,
        uint256 minProfitBps,
        uint256 maxUsdfAmount,
        bool isStable,
        bool isShortable,
        bytes32 action
    );
    event SignalPriceFeedSetTokenConfig(
        address vaultPriceFeed,
        address token,
        address priceFeed,
        uint256 priceDecimals,
        bool isStrictStable,
        bytes32 action
    );
    event ClearAction(bytes32 action);

    modifier onlyAdmin() {
        require(msg.sender == admin, "FxdxTimelock: forbidden");
        _;
    }

    modifier onlyAdminOrHandler() {
        require(msg.sender == admin || isHandler[msg.sender], "FxdxTimelock: forbidden");
        _;
    }

    modifier onlyTokenManager() {
        require(msg.sender == tokenManager, "FxdxTimelock: forbidden");
        _;
    }

    modifier onlyRewardManager() {
        require(msg.sender == rewardManager, "FxdxTimelock: forbidden");
        _;
    }

    constructor(
        address _admin,
        uint256 _buffer,
        uint256 _longBuffer,
        address _rewardManager,
        address _tokenManager,
        address _mintReceiver,
        uint256 _maxTokenSupply
    ) public {
        require(_buffer <= MAX_BUFFER, "FxdxTimelock: invalid _buffer");
        require(_longBuffer <= MAX_BUFFER, "FxdxTimelock: invalid _longBuffer");
        admin = _admin;
        buffer = _buffer;
        longBuffer = _longBuffer;
        rewardManager = _rewardManager;
        tokenManager = _tokenManager;
        mintReceiver = _mintReceiver;
        maxTokenSupply = _maxTokenSupply;
    }

    function setAdmin(address _admin) external override onlyTokenManager {
        admin = _admin;
    }

    function setExternalAdmin(address _target, address _admin) external onlyAdmin {
        require(_target != address(this), "FxdxTimelock: invalid _target");
        IAdmin(_target).setAdmin(_admin);
    }

    function setContractHandler(address _handler, bool _isActive) external onlyAdmin {
        isHandler[_handler] = _isActive;
    }

    function setBuffer(uint256 _buffer) external onlyAdmin {
        require(_buffer <= MAX_BUFFER, "FxdxTimelock: invalid _buffer");
        require(_buffer > buffer, "FxdxTimelock: buffer cannot be decreased");
        buffer = _buffer;
    }

    function setMaxLeverage(address _vault, uint256 _maxLeverage) external onlyAdmin {
      require(_maxLeverage > MAX_LEVERAGE_VALIDATION, "FxdxTimelock: invalid _maxLeverage");
      IVault(_vault).setMaxLeverage(_maxLeverage);
    }

    function setRolloverRateV1(address _feeUtils, uint256 _rolloverInterval, uint256 _rolloverRateFactor, uint256 _stableRolloverRateFactor) external onlyAdmin {
        require(_rolloverRateFactor < MAX_ROLLOVER_RATE_FACTOR, "FxdxTimelock: invalid _rolloverRateFactor");
        require(_stableRolloverRateFactor < MAX_ROLLOVER_RATE_FACTOR, "FxdxTimelock: invalid _stableRolloverRateFactor");
        IFeeUtilsV1(_feeUtils).setRolloverRate(_rolloverInterval, _rolloverRateFactor, _stableRolloverRateFactor);
    }

    function setRolloverIntervalV2(address _feeUtils, uint256 _rolloverInterval) external onlyAdmin {
        IFeeUtilsV2(_feeUtils).setRolloverInterval(_rolloverInterval);
    }

    function setFeeMinProfitTime(
        address _vault,
        uint256 _minProfitTime
    ) external onlyAdmin {
        IVault(_vault).setMinProfitTime(_minProfitTime);
    }

    function setFeesV1(
        address _feeUtils,
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd,
        bool _hasDynamicFees
    ) external onlyAdmin {
        require(_taxBasisPoints < MAX_FEE_BASIS_POINTS, "FxdxTimelock: invalid _taxBasisPoints");
        require(_stableTaxBasisPoints < MAX_FEE_BASIS_POINTS, "FxdxTimelock: invalid _stableTaxBasisPoints");
        require(_mintBurnFeeBasisPoints < MAX_FEE_BASIS_POINTS, "FxdxTimelock: invalid _mintBurnFeeBasisPoints");
        require(_swapFeeBasisPoints < MAX_FEE_BASIS_POINTS, "FxdxTimelock: invalid _swapFeeBasisPoints");
        require(_stableSwapFeeBasisPoints < MAX_FEE_BASIS_POINTS, "FxdxTimelock: invalid _stableSwapFeeBasisPoints");
        require(_marginFeeBasisPoints < MAX_FEE_BASIS_POINTS, "FxdxTimelock: invalid _marginFeeBasisPoints");
        require(_liquidationFeeUsd < 10 * PRICE_PRECISION, "FxdxTimelock: invalid _liquidationFeeUsd");

        IFeeUtilsV1(_feeUtils).setFees(
            _taxBasisPoints,
            _stableTaxBasisPoints,
            _mintBurnFeeBasisPoints,
            _swapFeeBasisPoints,
            _stableSwapFeeBasisPoints,
            _marginFeeBasisPoints,
            _liquidationFeeUsd,
            _hasDynamicFees
        );
    }

    function setLiquidationFeeUsdV2(address _feeUtils, uint256 _liquidationFeeUsd) external onlyAdmin {
        IFeeUtilsV2(_feeUtils).setLiquidationFeeUsd(_liquidationFeeUsd);
    }

    function setHasDynamicFeesV2(address _feeUtils, bool _hasDynamicFees) external onlyAdmin {
        IFeeUtilsV2(_feeUtils).setHasDynamicFees(_hasDynamicFees);
    }

    function setTokenFeeFactorsV2(
        address _feeUtils,
        address _token,
        uint256 _taxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _rolloverRateFactor,
        uint256[] memory _relativePnlList,
        uint256[] memory _positionFeeBpsList,
        uint256[] memory _profitFeeBpsList
    ) external onlyAdmin {
        require(_rolloverRateFactor < MAX_ROLLOVER_RATE_FACTOR, "Timelock: invalid _rolloverRateFactor");
        IFeeUtilsV2(_feeUtils).setTokenFeeFactors(
            _token,
            _taxBasisPoints,
            _mintBurnFeeBasisPoints,
            _swapFeeBasisPoints,
            _rolloverRateFactor,
            _relativePnlList,
            _positionFeeBpsList,
            _profitFeeBpsList
        );
    }

    function setTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxUsdfAmount,
        uint256 _bufferAmount,
        uint256 _usdfAmount
    ) external onlyAdmin {
        require(_minProfitBps <= 500, "FxdxTimelock: invalid _minProfitBps");

        IVault vault = IVault(_vault);
        require(vault.whitelistedTokens(_token), "FxdxTimelock: token not yet whitelisted");

        uint256 tokenDecimals = vault.tokenDecimals(_token);
        bool isStable = vault.stableTokens(_token);
        bool isShortable = vault.shortableTokens(_token);

        IVault(_vault).setTokenConfig(
            _token,
            tokenDecimals,
            _tokenWeight,
            _minProfitBps,
            _maxUsdfAmount,
            isStable,
            isShortable
        );

        IVault(_vault).setBufferAmount(_token, _bufferAmount);

        IVault(_vault).setUsdfAmount(_token, _usdfAmount);
    }

    function setMaxGlobalShortSize(address _vault, address _token, uint256 _amount) external onlyAdmin {
        IVault(_vault).setMaxGlobalShortSize(_token, _amount);
    }

    function removeAdmin(address _token, address _account) external onlyAdmin {
        IYieldToken(_token).removeAdmin(_account);
    }

    function setIsAmmEnabled(address _priceFeed, bool _isEnabled) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setIsAmmEnabled(_isEnabled);
    }

    function setIsSecondaryPriceEnabled(address _priceFeed, bool _isEnabled) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setIsSecondaryPriceEnabled(_isEnabled);
    }

    function setMaxStrictPriceDeviation(address _priceFeed, uint256 _maxStrictPriceDeviation) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setMaxStrictPriceDeviation(_maxStrictPriceDeviation);
    }

    function setUseV2Pricing(address _priceFeed, bool _useV2Pricing) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setUseV2Pricing(_useV2Pricing);
    }

    function setAdjustment(address _priceFeed, address _token, bool _isAdditive, uint256 _adjustmentBps) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setAdjustment(_token, _isAdditive, _adjustmentBps);
    }

    function setSpreadBasisPoints(address _priceFeed, address _token, uint256 _spreadBasisPoints) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setSpreadBasisPoints(_token, _spreadBasisPoints);
    }

    function setSpreadThresholdBasisPoints(address _priceFeed, uint256 _spreadThresholdBasisPoints) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setSpreadThresholdBasisPoints(_spreadThresholdBasisPoints);
    }

    function setFavorPrimaryPrice(address _priceFeed, bool _favorPrimaryPrice) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setFavorPrimaryPrice(_favorPrimaryPrice);
    }

    function setPriceSampleSpace(address _priceFeed,uint256 _priceSampleSpace) external onlyAdmin {
        require(_priceSampleSpace <= 5, "Invalid _priceSampleSpace");
        IVaultPriceFeed(_priceFeed).setPriceSampleSpace(_priceSampleSpace);
    }

    function setIsSwapEnabled(address _vault, bool _isSwapEnabled) external onlyAdmin {
        IVault(_vault).setIsSwapEnabled(_isSwapEnabled);
    }

    function setIsLeverageEnabled(address _vault, bool _isLeverageEnabled) external override onlyAdminOrHandler {
        IVault(_vault).setIsLeverageEnabled(_isLeverageEnabled);
    }

    function setVaultUtils(address _vault, IVaultUtils _vaultUtils) external onlyAdmin {
        IVault(_vault).setVaultUtils(_vaultUtils);
    }

    function setMaxGasPrice(address _vault,uint256 _maxGasPrice) external onlyAdmin {
        require(_maxGasPrice > 5000000000, "Invalid _maxGasPrice");
        IVault(_vault).setMaxGasPrice(_maxGasPrice);
    }

    function withdrawFees(address _vault,address _token, address _receiver) external onlyAdmin {
        IVault(_vault).withdrawFees(_token, _receiver);
    }

    function setInPrivateLiquidationMode(address _vault, bool _inPrivateLiquidationMode) external onlyAdmin {
        IVault(_vault).setInPrivateLiquidationMode(_inPrivateLiquidationMode);
    }

    function setLiquidator(address _vault, address _liquidator, bool _isActive) external onlyAdmin {
        IVault(_vault).setLiquidator(_liquidator, _isActive);
    }

    function addExcludedToken(address _token) external onlyAdmin {
        excludedTokens[_token] = true;
    }

    function setInPrivateTransferMode(address _token, bool _inPrivateTransferMode) external onlyAdmin {
        if (excludedTokens[_token]) {
            // excludedTokens can only have their transfers enabled
            require(_inPrivateTransferMode == false, "FxdxTimelock: invalid _inPrivateTransferMode");
        }

        IBaseToken(_token).setInPrivateTransferMode(_inPrivateTransferMode);
    }

    function transferIn(address _sender, address _token, uint256 _amount) external onlyAdmin {
        IERC20(_token).transferFrom(_sender, address(this), _amount);
    }

    function signalApprove(address _token, address _spender, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount));
        _setPendingAction(action);
        emit SignalApprove(_token, _spender, _amount, action);
    }

    function approve(address _token, address _spender, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount));
        _validateAction(action);
        _clearAction(action);
        IERC20(_token).approve(_spender, _amount);
    }

    function signalWithdrawToken(address _target, address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("withdrawToken", _target, _token, _receiver, _amount));
        _setPendingAction(action);
        emit SignalWithdrawToken(_target, _token, _receiver, _amount, action);
    }

    function withdrawToken(address _target, address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("withdrawToken", _target, _token, _receiver, _amount));
        _validateAction(action);
        _clearAction(action);
        IBaseToken(_target).withdrawToken(_token, _receiver, _amount);
    }

    function signalMint(address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("mint", _token, _receiver, _amount));
        _setPendingAction(action);
        emit SignalMint(_token, _receiver, _amount, action);
    }

    function processMint(address _token, address _receiver, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("mint", _token, _receiver, _amount));
        _validateAction(action);
        _clearAction(action);

        _mint(_token, _receiver, _amount);
    }

    function signalSetGov(address _target, address _gov) external override onlyTokenManager {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        _setLongPendingAction(action);
        emit SignalSetGov(_target, _gov, action);
    }

    function setGov(address _target, address _gov) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        _validateAction(action);
        _clearAction(action);
        ITimelockTarget(_target).setGov(_gov);
    }

    function signalSetPriceFeed(address _vault, address _priceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setPriceFeed", _vault, _priceFeed));
        _setPendingAction(action);
        emit SignalSetPriceFeed(_vault, _priceFeed, action);
    }

    function setPriceFeed(address _vault, address _priceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setPriceFeed", _vault, _priceFeed));
        _validateAction(action);
        _clearAction(action);
        IVault(_vault).setPriceFeed(_priceFeed);
    }

    function signalAddPlugin(address _router, address _plugin) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("addPlugin", _router, _plugin));
        _setPendingAction(action);
        emit SignalAddPlugin(_router, _plugin, action);
    }

    function addPlugin(address _router, address _plugin) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("addPlugin", _router, _plugin));
        _validateAction(action);
        _clearAction(action);
        IRouter(_router).addPlugin(_plugin);
    }

    function signalRedeemUsdf(address _vault, address _token, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("redeemUsdf", _vault, _token, _amount));
        _setPendingAction(action);
        emit SignalRedeemUsdf(_vault, _token, _amount, action);
    }

    function redeemUsdf(address _vault, address _token, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("redeemUsdf", _vault, _token, _amount));
        _validateAction(action);
        _clearAction(action);

        address usdf = IVault(_vault).usdf();
        IVault(_vault).setManager(address(this), true);
        IUSDF(usdf).addVault(address(this));

        IUSDF(usdf).mint(address(this), _amount);
        IERC20(usdf).transfer(address(_vault), _amount);

        IVault(_vault).sellUSDF(_token, mintReceiver);

        IVault(_vault).setManager(address(this), false);
        IUSDF(usdf).removeVault(address(this));
    }

    function signalVaultSetTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenDecimals,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxUsdfAmount,
        bool _isStable,
        bool _isShortable
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "vaultSetTokenConfig",
            _vault,
            _token,
            _tokenDecimals,
            _tokenWeight,
            _minProfitBps,
            _maxUsdfAmount,
            _isStable,
            _isShortable
        ));

        _setPendingAction(action);

        emit SignalVaultSetTokenConfig(
            _vault,
            _token,
            _tokenDecimals,
            _tokenWeight,
            _minProfitBps,
            _maxUsdfAmount,
            _isStable,
            _isShortable,
            action
        );
    }

    function vaultSetTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenDecimals,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxUsdfAmount,
        bool _isStable,
        bool _isShortable
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "vaultSetTokenConfig",
            _vault,
            _token,
            _tokenDecimals,
            _tokenWeight,
            _minProfitBps,
            _maxUsdfAmount,
            _isStable,
            _isShortable
        ));

        _validateAction(action);
        _clearAction(action);

        IVault(_vault).setTokenConfig(
            _token,
            _tokenDecimals,
            _tokenWeight,
            _minProfitBps,
            _maxUsdfAmount,
            _isStable,
            _isShortable
        );
    }

    function signalPriceFeedSetTokenConfig(
        address _vaultPriceFeed,
        address _token,
        address _priceFeed,
        uint256 _priceDecimals,
        bool _isStrictStable
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "priceFeedSetTokenConfig",
            _vaultPriceFeed,
            _token,
            _priceFeed,
            _priceDecimals,
            _isStrictStable
        ));

        _setPendingAction(action);

        emit SignalPriceFeedSetTokenConfig(
            _vaultPriceFeed,
            _token,
            _priceFeed,
            _priceDecimals,
            _isStrictStable,
            action
        );
    }

    function priceFeedSetTokenConfig(
        address _vaultPriceFeed,
        address _token,
        address _priceFeed,
        uint256 _priceDecimals,
        bool _isStrictStable
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "priceFeedSetTokenConfig",
            _vaultPriceFeed,
            _token,
            _priceFeed,
            _priceDecimals,
            _isStrictStable
        ));

        _validateAction(action);
        _clearAction(action);

        IVaultPriceFeed(_vaultPriceFeed).setTokenConfig(
            _token,
            _priceFeed,
            _priceDecimals,
            _isStrictStable
        );
    }

    function cancelAction(bytes32 _action) external onlyAdmin {
        _clearAction(_action);
    }

    function _mint(address _token, address _receiver, uint256 _amount) private {
        IMintable mintable = IMintable(_token);

        if (!mintable.isMinter(address(this))) {
            mintable.setMinter(address(this), true);
        }

        mintable.mint(_receiver, _amount);
        require(IERC20(_token).totalSupply() <= maxTokenSupply, "FxdxTimelock: maxTokenSupply exceeded");
    }

    function _setPendingAction(bytes32 _action) private {
        pendingActions[_action] = block.timestamp.add(buffer);
        emit SignalPendingAction(_action);
    }

    function _setLongPendingAction(bytes32 _action) private {
        pendingActions[_action] = block.timestamp.add(longBuffer);
        emit SignalPendingAction(_action);
    }

    function _validateAction(bytes32 _action) private view {
        require(pendingActions[_action] != 0, "FxdxTimelock: action not signalled");
        require(pendingActions[_action] < block.timestamp, "FxdxTimelock: action time not yet passed");
    }

    function _clearAction(bytes32 _action) private {
        require(pendingActions[_action] != 0, "FxdxTimelock: invalid _action");
        delete pendingActions[_action];
        emit ClearAction(_action);
    }
}
