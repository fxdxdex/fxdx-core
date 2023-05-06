// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";

import "./interfaces/IVault.sol";
import "./interfaces/IFeeUtils.sol";
import "./interfaces/IFeeUtilsV1.sol";

contract FeeUtilsV1 is IFeeUtils, IFeeUtilsV1 {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    uint256 public constant ROLLOVER_RATE_PRECISION = 1000000;
    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MAX_FEE_BASIS_POINTS = 500; // 5%
    uint256 public constant MAX_LIQUIDATION_FEE_USD = 100 * PRICE_PRECISION; // 100 USD
    uint256 public constant MIN_ROLLOVER_RATE_INTERVAL = 1 hours;
    uint256 public constant MAX_ROLLOVER_RATE_FACTOR = 10000; // 1%

    bool public override isInitialized;

    IVault public vault;
    address public override gov;

    uint256 public override feeMultiplierIfInactive = 10; // 10x
    bool public override isActive = false;

    uint256 public override liquidationFeeUsd;
    uint256 public override taxBasisPoints = 50; // 0.5%
    uint256 public override stableTaxBasisPoints = 20; // 0.2%
    uint256 public override mintBurnFeeBasisPoints = 30; // 0.3%
    uint256 public override swapFeeBasisPoints = 30; // 0.3%
    uint256 public override stableSwapFeeBasisPoints = 4; // 0.04%
    uint256 public override marginFeeBasisPoints = 10; // 0.1%

    bool public override hasDynamicFees = false;

    uint256 public override rolloverInterval = 8 hours;
    uint256 public override rolloverRateFactor;
    uint256 public override stableRolloverRateFactor;

    // cumulativeRolloverRates tracks the rollover rates based on utilization
    mapping(address => uint256) public override cumulativeRolloverRates;
    // lastRolloverTimes tracks the last time rollover was updated for a token
    mapping(address => uint256) public override lastRolloverTimes;

    event UpdateRolloverRate(address token, uint256 rolloverRate);

    // once the parameters are verified to be working correctly,
    // gov should be set to a timelock contract or a governance contract
    constructor(IVault _vault) public {
        gov = msg.sender;
        vault = _vault;
    }

    modifier afterInitialized() {
        require(isInitialized, "FeeUtilsV1: not initialized yet");
        _;
    }

    function initialize(
        uint256 _liquidationFeeUsd,
        uint256 _rolloverRateFactor,
        uint256 _stableRolloverRateFactor
    ) external {
        _onlyGov();
        require(!isInitialized, "FeeUtilsV1: already initialized");
        isInitialized = true;

        liquidationFeeUsd = _liquidationFeeUsd;
        rolloverRateFactor = _rolloverRateFactor;
        stableRolloverRateFactor = _stableRolloverRateFactor;
    }

    function setGov(address _gov) external {
        _onlyGov();
        gov = _gov;
    }

    function setFeeMultiplierIfInactive(uint256 _feeMultiplierIfInactive) external override {
        _onlyGov();
        require(_feeMultiplierIfInactive >= 1, "FeeUtilsV1: invalid _feeMultiplierIfInactive");
        feeMultiplierIfInactive = _feeMultiplierIfInactive;
    }

    function setIsActive(bool _isActive) external override afterInitialized {
        _onlyGov();
        isActive = _isActive;
    }

    function setFees(
        uint256 _taxBasisPoints,
        uint256 _stableTaxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd,
        bool _hasDynamicFees
    ) external override {
        _onlyGov();
        require(
            _taxBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV1: invalid _taxBasisPoints"
        );
        require(
            _stableTaxBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV1: invalid _stableTaxBasisPoints"
        );
        require(
            _mintBurnFeeBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV1: invalid _mintBurnFeeBasisPoints"
        );
        require(
            _swapFeeBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV1: invalid _swapFeeBasisPoints"
        );
        require(
            _stableSwapFeeBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV1: invalid _stableSwapFeeBasisPoints"
        );
        require(
            _marginFeeBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV1: invalid _marginFeeBasisPoints"
        );
        require(
            _liquidationFeeUsd <= MAX_LIQUIDATION_FEE_USD,
            "FeeUtilsV1: invalid _liquidationFeeUsd"
        );
        taxBasisPoints = _taxBasisPoints;
        stableTaxBasisPoints = _stableTaxBasisPoints;
        mintBurnFeeBasisPoints = _mintBurnFeeBasisPoints;
        swapFeeBasisPoints = _swapFeeBasisPoints;
        stableSwapFeeBasisPoints = _stableSwapFeeBasisPoints;
        marginFeeBasisPoints = _marginFeeBasisPoints;
        liquidationFeeUsd = _liquidationFeeUsd;
        hasDynamicFees = _hasDynamicFees;
    }

    function getLiquidationFeeUsd() external override view afterInitialized returns (uint256) {
        return liquidationFeeUsd;
    }

    function getBaseIncreasePositionFeeBps(address /* _indexToken */) external override view afterInitialized returns(uint256) {
        return marginFeeBasisPoints;
    }

    function getBaseDecreasePositionFeeBps(address /* _indexToken */) external override view afterInitialized returns(uint256) {
        return marginFeeBasisPoints;
    }

    function setRolloverRate(
        uint256 _rolloverInterval,
        uint256 _rolloverRateFactor,
        uint256 _stableRolloverRateFactor
    ) external override {
        _onlyGov();
        require(
            _rolloverInterval >= MIN_ROLLOVER_RATE_INTERVAL,
            "FeeUtilsV1: invalid _rolloverInterval"
        );
        require(
            _rolloverRateFactor <= MAX_ROLLOVER_RATE_FACTOR,
            "FeeUtilsV1: invalid _rolloverRateFactor"
        );
        require(
            _stableRolloverRateFactor <= MAX_ROLLOVER_RATE_FACTOR,
            "FeeUtilsV1: invalid _stableRolloverRateFactor"
        );
        rolloverInterval = _rolloverInterval;
        rolloverRateFactor = _rolloverRateFactor;
        stableRolloverRateFactor = _stableRolloverRateFactor;
    }

    function updateCumulativeRolloverRate(address _collateralToken) external override afterInitialized {
        if (lastRolloverTimes[_collateralToken] == 0) {
            lastRolloverTimes[_collateralToken] = block
                .timestamp
                .div(rolloverInterval)
                .mul(rolloverInterval);
            return;
        }

        if (lastRolloverTimes[_collateralToken].add(rolloverInterval) > block.timestamp) {
            return;
        }

        uint256 rolloverRate = getNextRolloverRate(_collateralToken);
        cumulativeRolloverRates[_collateralToken] = cumulativeRolloverRates[_collateralToken].add(rolloverRate);
        lastRolloverTimes[_collateralToken] = block
            .timestamp
            .div(rolloverInterval)
            .mul(rolloverInterval);

        emit UpdateRolloverRate(
            _collateralToken,
            cumulativeRolloverRates[_collateralToken]
        );
    }

    function getNextRolloverRate(address _token) public view override afterInitialized returns (uint256) {
        if (lastRolloverTimes[_token].add(rolloverInterval) > block.timestamp) {
            return 0;
        }

        uint256 intervals = block.timestamp.sub(lastRolloverTimes[_token]).div(rolloverInterval);
        uint256 poolAmount = vault.poolAmounts(_token);
        if (poolAmount == 0) {
            return 0;
        }

        uint256 _rolloverRateFactor = vault.stableTokens(_token)
            ? stableRolloverRateFactor
            : rolloverRateFactor;

        return _rolloverRateFactor
            .mul(vault.reservedAmounts(_token))
            .mul(intervals)
            .div(poolAmount);
    }

    function getEntryRolloverRate( address _collateralToken ) public override view afterInitialized returns (uint256) {
        return cumulativeRolloverRates[_collateralToken];
    }

    function getRolloverRates(address _weth, address[] memory _tokens) external override view afterInitialized returns (uint256[] memory) {
        uint256 propsLength = 2;
        uint256[] memory rolloverRates = new uint256[](_tokens.length * propsLength);

        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }

            uint256 rolloverRate = vault.stableTokens(token) ? stableRolloverRateFactor : rolloverRateFactor;
            uint256 reservedAmount = vault.reservedAmounts(token);
            uint256 poolAmount = vault.poolAmounts(token);

            if (poolAmount > 0) {
                rolloverRates[i * propsLength] = rolloverRate.mul(reservedAmount).div(poolAmount);
            }

            if (cumulativeRolloverRates[token] > 0) {
                uint256 nextRate = getNextRolloverRate(token);
                uint256 baseRate = cumulativeRolloverRates[token];
                rolloverRates[i * propsLength + 1] = baseRate.add(nextRate);
            }
        }

        return rolloverRates;
    }

    function getRolloverFee(
        address _collateralToken,
        uint256 _size,
        uint256 _entryRolloverRate
    ) external view override afterInitialized returns (uint256) {
        if (_size == 0) {
            return 0;
        }

        uint256 rolloverRate = cumulativeRolloverRates[_collateralToken].sub(_entryRolloverRate);
        if (rolloverRate == 0) {
            return 0;
        }

        uint256 multiplier = isActive ? 1 : feeMultiplierIfInactive;

        return _size.mul(rolloverRate).mul(multiplier).div(ROLLOVER_RATE_PRECISION);
    }

    function getIncreasePositionFee(
        address /* _account */,
        address /* _collateralToken */,
        address /* _indexToken */,
        bool /* _isLong */,
        uint256 _sizeDelta
    ) external view override afterInitialized returns (uint256) {
        if (_sizeDelta == 0) {
            return 0;
        }
        uint256 afterFeeUsd = _sizeDelta
            .mul(BASIS_POINTS_DIVISOR.sub(marginFeeBasisPoints))
            .div(BASIS_POINTS_DIVISOR);

        uint256 multiplier = isActive ? 1 : feeMultiplierIfInactive;

        return _sizeDelta.sub(afterFeeUsd).mul(multiplier);
    }

    function getDecreasePositionFee(
        address /* _account */,
        address /* _collateralToken */,
        address /* _indexToken */,
        bool /* _isLong */,
        uint256 _sizeDelta
    ) external view override afterInitialized returns (uint256) {
        if (_sizeDelta == 0) {
            return 0;
        }
        uint256 afterFeeUsd = _sizeDelta
            .mul(BASIS_POINTS_DIVISOR.sub(marginFeeBasisPoints))
            .div(BASIS_POINTS_DIVISOR);

        uint256 multiplier = isActive ? 1 : feeMultiplierIfInactive;

        return _sizeDelta.sub(afterFeeUsd).mul(multiplier);
    }

    function getBuyUsdfFeeBasisPoints(
        address _token,
        uint256 _usdfAmount
    ) public view override afterInitialized returns (uint256) {
        return getFeeBasisPoints(
            _token,
            _usdfAmount,
            mintBurnFeeBasisPoints,
            taxBasisPoints,
            true
        );
    }

    function getSellUsdfFeeBasisPoints(
        address _token,
        uint256 _usdfAmount
    ) public view override afterInitialized returns (uint256) {
        return getFeeBasisPoints(
            _token,
            _usdfAmount,
            mintBurnFeeBasisPoints,
            taxBasisPoints,
            false
        );
    }

    function getSwapFeeBasisPoints(
        address _tokenIn,
        address _tokenOut,
        uint256 _usdfAmount
    ) public view override afterInitialized returns (uint256) {
        bool isStableSwap = vault.stableTokens(_tokenIn) && vault.stableTokens(_tokenOut);
        uint256 baseBps = isStableSwap
            ? stableSwapFeeBasisPoints
            : swapFeeBasisPoints;
        uint256 taxBps = isStableSwap
            ? stableTaxBasisPoints
            : taxBasisPoints;
        uint256 feesBasisPoints0 = getFeeBasisPoints(
            _tokenIn,
            _usdfAmount,
            baseBps,
            taxBps,
            true
        );
        uint256 feesBasisPoints1 = getFeeBasisPoints(
            _tokenOut,
            _usdfAmount,
            baseBps,
            taxBps,
            false
        );
        // use the higher of the two fee basis points
        return feesBasisPoints0 > feesBasisPoints1
            ? feesBasisPoints0
            : feesBasisPoints1;
    }

    // cases to consider
    // 1. initialAmount is far from targetAmount, action increases balance slightly => high rebate
    // 2. initialAmount is far from targetAmount, action increases balance largely => high rebate
    // 3. initialAmount is close to targetAmount, action increases balance slightly => low rebate
    // 4. initialAmount is far from targetAmount, action reduces balance slightly => high tax
    // 5. initialAmount is far from targetAmount, action reduces balance largely => high tax
    // 6. initialAmount is close to targetAmount, action reduces balance largely => low tax
    // 7. initialAmount is above targetAmount, nextAmount is below targetAmount and vice versa
    // 8. a large swap should have similar fees as the same trade split into multiple smaller swaps
    function getFeeBasisPoints(
        address _token,
        uint256 _usdfDelta,
        uint256 _feeBasisPoints,
        uint256 _taxBasisPoints,
        bool _increment
    ) public view override afterInitialized returns (uint256) {
        uint256 feeBps = _feeBasisPoints.mul(isActive ? 1 : feeMultiplierIfInactive);

        if (!hasDynamicFees) {
            return feeBps;
        }

        uint256 initialAmount = vault.usdfAmounts(_token);
        uint256 nextAmount = initialAmount.add(_usdfDelta);
        if (!_increment) {
            nextAmount = _usdfDelta > initialAmount
                ? 0
                : initialAmount.sub(_usdfDelta);
        }

        uint256 targetAmount = vault.getTargetUsdfAmount(_token);
        if (targetAmount == 0) {
            return feeBps;
        }

        uint256 initialDiff = initialAmount > targetAmount
            ? initialAmount.sub(targetAmount)
            : targetAmount.sub(initialAmount);
        uint256 nextDiff = nextAmount > targetAmount
            ? nextAmount.sub(targetAmount)
            : targetAmount.sub(nextAmount);

        // action improves relative asset balance
        if (nextDiff < initialDiff) {
            uint256 rebateBps = _taxBasisPoints.mul(initialDiff).div(
                targetAmount
            );
            return rebateBps > feeBps
                ? 0
                : feeBps.sub(rebateBps);
        }

        uint256 averageDiff = initialDiff.add(nextDiff).div(2);
        if (averageDiff > targetAmount) {
            averageDiff = targetAmount;
        }
        uint256 taxBps = _taxBasisPoints.mul(averageDiff).div(targetAmount);
        return feeBps.add(taxBps);
    }

    // we have this validation as a function instead of a modifier to reduce contract size
    function _onlyGov() private view {
        require(msg.sender == gov, "FeeUtilsV1: forbidden");
    }

    function getStates() public view returns (
        address[] memory,
        uint256[] memory,
        bool[] memory
    ) {
        address[] memory addressValues = new address[](2);
        uint256[] memory intValues = new uint256[](11);
        bool[] memory boolValues = new bool[](2);

        addressValues[0] = gov;
        addressValues[1] = address(vault);

        intValues[0] = liquidationFeeUsd;
        intValues[1] = taxBasisPoints;
        intValues[2] = stableTaxBasisPoints;
        intValues[3] = mintBurnFeeBasisPoints;
        intValues[4] = swapFeeBasisPoints;
        intValues[5] = stableSwapFeeBasisPoints;
        intValues[6] = marginFeeBasisPoints;
        intValues[7] = rolloverInterval;
        intValues[8] = rolloverRateFactor;
        intValues[9] = stableRolloverRateFactor;
        intValues[10] = feeMultiplierIfInactive;

        boolValues[0] = hasDynamicFees;
        boolValues[1] = isActive;

        return (
            addressValues,
            intValues,
            boolValues
        );
    }
}
