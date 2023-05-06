// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/ITimelockTarget.sol";
import "./interfaces/ITimelock.sol";
import "./interfaces/IHandlerTarget.sol";
import "../access/interfaces/IAdmin.sol";
import "../core/interfaces/IVault.sol";
import "../core/interfaces/IVaultUtils.sol";
import "../core/interfaces/IFeeUtilsV1.sol";
import "../core/interfaces/IFeeUtilsV2.sol";
import "../core/interfaces/IFlpManager.sol";
import "../referrals/interfaces/IReferralStorage.sol";
import "../tokens/interfaces/IYieldToken.sol";
import "../tokens/interfaces/IBaseToken.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IUSDF.sol";
import "../staking/interfaces/IVester.sol";

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

contract Timelock is ITimelock {
    using SafeMath for uint256;

    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MAX_BUFFER = 5 days;
    uint256 public constant MAX_ROLLOVER_RATE_FACTOR = 200; // 0.02%
    uint256 public constant MAX_LEVERAGE_VALIDATION = 500000; // 50x

    uint256 public buffer;
    address public admin;

    address public tokenManager;
    address public mintReceiver;
    address public flpManager;
    uint256 public maxTokenSupply;

    bool public shouldToggleIsLeverageEnabled;

    mapping (bytes32 => uint256) public pendingActions;

    mapping (address => bool) public isHandler;
    mapping (address => bool) public isKeeper;

    event SignalPendingAction(bytes32 action);
    event SignalApprove(address token, address spender, uint256 amount, bytes32 action);
    event SignalWithdrawToken(address target, address token, address receiver, uint256 amount, bytes32 action);
    event SignalMint(address token, address receiver, uint256 amount, bytes32 action);
    event SignalSetGov(address target, address gov, bytes32 action);
    event SignalSetHandler(address target, address handler, bool isActive, bytes32 action);
    event SignalSetPriceFeed(address vault, address priceFeed, bytes32 action);
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
    event SignalVaultClearTokenConfig(
        address vault,
        address token,
        bytes32 action
    );
    event ClearAction(bytes32 action);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Timelock: forbidden");
        _;
    }

    modifier onlyHandlerAndAbove() {
        require(msg.sender == admin || isHandler[msg.sender], "Timelock: forbidden");
        _;
    }

    modifier onlyKeeperAndAbove() {
        require(msg.sender == admin || isHandler[msg.sender] || isKeeper[msg.sender], "Timelock: forbidden");
        _;
    }

    modifier onlyTokenManager() {
        require(msg.sender == tokenManager, "Timelock: forbidden");
        _;
    }

    constructor(
        address _admin,
        uint256 _buffer,
        address _tokenManager,
        address _mintReceiver,
        address _flpManager,
        uint256 _maxTokenSupply
    ) public {
        require(_buffer <= MAX_BUFFER, "Timelock: invalid _buffer");
        admin = _admin;
        buffer = _buffer;
        tokenManager = _tokenManager;
        mintReceiver = _mintReceiver;
        flpManager = _flpManager;
        maxTokenSupply = _maxTokenSupply;
    }

    function setAdmin(address _admin) external override onlyTokenManager {
        admin = _admin;
    }

    function setExternalAdmin(address _target, address _admin) external onlyAdmin {
        require(_target != address(this), "Timelock: invalid _target");
        IAdmin(_target).setAdmin(_admin);
    }

    function setContractHandler(address _handler, bool _isActive) external onlyAdmin {
        isHandler[_handler] = _isActive;
    }

    function setKeeper(address _keeper, bool _isActive) external onlyAdmin {
        isKeeper[_keeper] = _isActive;
    }

    function setBuffer(uint256 _buffer) external onlyAdmin {
        require(_buffer <= MAX_BUFFER, "Timelock: invalid _buffer");
        require(_buffer > buffer, "Timelock: buffer cannot be decreased");
        buffer = _buffer;
    }

    function setShouldToggleIsLeverageEnabled(bool _shouldToggleIsLeverageEnabled) external onlyHandlerAndAbove {
        shouldToggleIsLeverageEnabled = _shouldToggleIsLeverageEnabled;
    }

    function enableLeverage(address _vault) external override onlyHandlerAndAbove {
        IVault vault = IVault(_vault);

        if (shouldToggleIsLeverageEnabled) {
            vault.setIsLeverageEnabled(true);
        }

        IFeeUtils feeUtils = IFeeUtils(vault.getFeeUtils());

        feeUtils.setIsActive(true);
    }

    function disableLeverage(address _vault) external override onlyHandlerAndAbove {
        IVault vault = IVault(_vault);

        if (shouldToggleIsLeverageEnabled) {
            vault.setIsLeverageEnabled(false);
        }

        IFeeUtils feeUtils = IFeeUtils(vault.getFeeUtils());

        feeUtils.setIsActive(false);
    }

    function activateFeeUtils(address _vault) external override onlyHandlerAndAbove {
        IVault vault = IVault(_vault);
        IFeeUtils feeUtils = IFeeUtils(vault.getFeeUtils());

        feeUtils.setIsActive(true);
    }

    function deactivateFeeUtils(address _vault) external override onlyHandlerAndAbove {
        IVault vault = IVault(_vault);
        IFeeUtils feeUtils = IFeeUtils(vault.getFeeUtils());

        feeUtils.setIsActive(false);
    }

    function setMaxLeverage(address _vault, uint256 _maxLeverage) external onlyAdmin {
      require(_maxLeverage > MAX_LEVERAGE_VALIDATION, "Timelock: invalid _maxLeverage");
      IVault(_vault).setMaxLeverage(_maxLeverage);
    }

    function setMinProfitTime(
        address _vault,
        uint256 _minProfitTime
    ) external onlyKeeperAndAbove {
        IVault(_vault).setMinProfitTime(_minProfitTime);
    }

    function setFeeMultiplierIfInactive(address _feeUtils, uint256 _feeMultiplierIfInactive) external onlyKeeperAndAbove {
        IFeeUtils(_feeUtils).setFeeMultiplierIfInactive(_feeMultiplierIfInactive);
    }

    function setRolloverRateV1(address _feeUtils, uint256 _rolloverInterval, uint256 _rolloverRateFactor, uint256 _stableRolloverRateFactor) external onlyKeeperAndAbove {
        require(_rolloverRateFactor < MAX_ROLLOVER_RATE_FACTOR, "Timelock: invalid _rolloverRateFactor");
        require(_stableRolloverRateFactor < MAX_ROLLOVER_RATE_FACTOR, "Timelock: invalid _stableRolloverRateFactor");
        IFeeUtilsV1(_feeUtils).setRolloverRate(_rolloverInterval, _rolloverRateFactor, _stableRolloverRateFactor);
    }

    function setRolloverIntervalV2(address _feeUtils, uint256 _rolloverInterval) external onlyKeeperAndAbove {
        IFeeUtilsV2(_feeUtils).setRolloverInterval(_rolloverInterval);
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
    ) external onlyKeeperAndAbove {
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

    function setLiquidationFeeUsdV2(address _feeUtils, uint256 _liquidationFeeUsd) external onlyKeeperAndAbove {
        IFeeUtilsV2(_feeUtils).setLiquidationFeeUsd(_liquidationFeeUsd);
    }

    function setHasDynamicFeesV2(address _feeUtils, bool _hasDynamicFees) external onlyKeeperAndAbove {
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
    ) external onlyKeeperAndAbove {
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

    function setIsSwapEnabled(address _vault, bool _isSwapEnabled) external onlyKeeperAndAbove {
        IVault(_vault).setIsSwapEnabled(_isSwapEnabled);
    }

    function setIsLeverageEnabled(address _vault, bool _isLeverageEnabled) external override onlyHandlerAndAbove {
        IVault(_vault).setIsLeverageEnabled(_isLeverageEnabled);
    }

    function setTokenConfig(
        address _vault,
        address _token,
        uint256 _tokenWeight,
        uint256 _minProfitBps,
        uint256 _maxUsdfAmount,
        uint256 _bufferAmount,
        uint256 _usdfAmount
    ) external onlyKeeperAndAbove {
        require(_minProfitBps <= 500, "Timelock: invalid _minProfitBps");

        IVault vault = IVault(_vault);
        require(vault.whitelistedTokens(_token), "Timelock: token not yet whitelisted");

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

    function setUsdfAmounts(address _vault, address[] memory _tokens, uint256[] memory _usdfAmounts) external onlyKeeperAndAbove {
        for (uint256 i = 0; i < _tokens.length; i++) {
            IVault(_vault).setUsdfAmount(_tokens[i], _usdfAmounts[i]);
        }
    }

    function updateUsdfSupply(uint256 usdfAmount) external onlyKeeperAndAbove {
        address usdf = IFlpManager(flpManager).usdf();
        uint256 balance = IERC20(usdf).balanceOf(flpManager);

        IUSDF(usdf).addVault(address(this));

        if (usdfAmount > balance) {
            uint256 mintAmount = usdfAmount.sub(balance);
            IUSDF(usdf).mint(flpManager, mintAmount);
        } else {
            uint256 burnAmount = balance.sub(usdfAmount);
            IUSDF(usdf).burn(flpManager, burnAmount);
        }

        IUSDF(usdf).removeVault(address(this));
    }

    function setMaxGlobalShortSize(address _vault, address _token, uint256 _amount) external onlyAdmin {
        IVault(_vault).setMaxGlobalShortSize(_token, _amount);
    }

    function removeAdmin(address _token, address _account) external onlyAdmin {
        IYieldToken(_token).removeAdmin(_account);
    }

    function setTier(address _referralStorage, uint256 _tierId, uint256 _totalRebate, uint256 _discountShare) external onlyKeeperAndAbove {
        IReferralStorage(_referralStorage).setTier(_tierId, _totalRebate, _discountShare);
    }

    function setReferrerTier(address _referralStorage, address _referrer, uint256 _tierId) external onlyKeeperAndAbove {
        IReferralStorage(_referralStorage).setReferrerTier(_referrer, _tierId);
    }

    function govSetCodeOwner(address _referralStorage, bytes32 _code, address _newAccount) external onlyKeeperAndAbove {
        IReferralStorage(_referralStorage).govSetCodeOwner(_code, _newAccount);
    }

    function setVaultUtils(address _vault, IVaultUtils _vaultUtils) external onlyAdmin {
        IVault(_vault).setVaultUtils(_vaultUtils);
    }

    function setFeeUtils(address _vault, IFeeUtils _feeUtils) external onlyAdmin {
        IVault(_vault).setFeeUtils(_feeUtils);
    }

    function setMaxGasPrice(address _vault, uint256 _maxGasPrice) external onlyAdmin {
        require(_maxGasPrice > 5000000000, "Invalid _maxGasPrice");
        IVault(_vault).setMaxGasPrice(_maxGasPrice);
    }

    function withdrawFees(address _vault, address _token, address _receiver) external onlyAdmin {
        IVault(_vault).withdrawFees(_token, _receiver);
    }

    function batchWithdrawFees(address _vault, address[] memory _tokens) external onlyKeeperAndAbove {
        for (uint256 i = 0; i < _tokens.length; i++) {
            IVault(_vault).withdrawFees(_tokens[i], admin);
        }
    }

    function setInPrivateLiquidationMode(address _vault, bool _inPrivateLiquidationMode) external onlyAdmin {
        IVault(_vault).setInPrivateLiquidationMode(_inPrivateLiquidationMode);
    }

    function setLiquidator(address _vault, address _liquidator, bool _isActive) external onlyAdmin {
        IVault(_vault).setLiquidator(_liquidator, _isActive);
    }

    function setInPrivateTransferMode(address _token, bool _inPrivateTransferMode) external onlyAdmin {
        IBaseToken(_token).setInPrivateTransferMode(_inPrivateTransferMode);
    }

    function batchSetBonusRewards(address _vester, address[] memory _accounts, uint256[] memory _amounts) external onlyKeeperAndAbove {
        require(_accounts.length == _amounts.length, "Timelock: invalid lengths");

        if (!IHandlerTarget(_vester).isHandler(address(this))) {
            IHandlerTarget(_vester).setHandler(address(this), true);
        }

        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            uint256 amount = _amounts[i];
            IVester(_vester).setBonusRewards(account, amount);
        }
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

    function signalSetGov(address _target, address _gov) external override onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        _setPendingAction(action);
        emit SignalSetGov(_target, _gov, action);
    }

    function setGov(address _target, address _gov) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        _validateAction(action);
        _clearAction(action);
        ITimelockTarget(_target).setGov(_gov);
    }

    function signalSetHandler(address _target, address _handler, bool _isActive) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setHandler", _target, _handler, _isActive));
        _setPendingAction(action);
        emit SignalSetHandler(_target, _handler, _isActive, action);
    }

    function setHandler(address _target, address _handler, bool _isActive) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setHandler", _target, _handler, _isActive));
        _validateAction(action);
        _clearAction(action);
        IHandlerTarget(_target).setHandler(_handler, _isActive);
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

    function signalVaultClearTokenConfig(
        address _vault,
        address _token
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "vaultClearTokenConfig",
            _vault,
            _token
        ));

        _setPendingAction(action);

        emit SignalVaultClearTokenConfig(
            _vault,
            _token,
            action
        );
    }

    function vaultClearTokenConfig(
        address _vault,
        address _token
    ) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "vaultClearTokenConfig",
            _vault,
            _token
        ));

        _validateAction(action);
        _clearAction(action);

        IVault(_vault).clearTokenConfig(_token);
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
        require(IERC20(_token).totalSupply() <= maxTokenSupply, "Timelock: maxTokenSupply exceeded");
    }

    function _setPendingAction(bytes32 _action) private {
        require(pendingActions[_action] == 0, "Timelock: action already signalled");
        pendingActions[_action] = block.timestamp.add(buffer);
        emit SignalPendingAction(_action);
    }

    function _validateAction(bytes32 _action) private view {
        require(pendingActions[_action] != 0, "Timelock: action not signalled");
        require(pendingActions[_action] < block.timestamp, "Timelock: action time not yet passed");
    }

    function _clearAction(bytes32 _action) private {
        require(pendingActions[_action] != 0, "Timelock: invalid _action");
        delete pendingActions[_action];
        emit ClearAction(_action);
    }

    function getStates() public view returns (
        address[] memory,
        uint256[] memory,
        bool[] memory
    ) {
        address[] memory addressValues = new address[](3);
        uint256[] memory intValues = new uint256[](1);
        bool[] memory boolValues = new bool[](1);

        addressValues[0] = admin;
        addressValues[1] = tokenManager;
        addressValues[2] = mintReceiver;

        intValues[0] = buffer;

        boolValues[0] = shouldToggleIsLeverageEnabled;

        return (
            addressValues,
            intValues,
            boolValues
        );
    }
}
