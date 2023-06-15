// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";

import "./interfaces/IVault.sol";
import "./interfaces/IFeeUtils.sol";
import "./interfaces/IFeeUtilsV2.sol";

contract FeeUtilsV2 is IFeeUtils, IFeeUtilsV2 {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct Position {
        uint256 size;
        uint256 collateral;
        uint256 averagePrice;
        uint256 entryRolloverRate;
        uint256 reserveAmount;
        int256 realisedPnl;
        uint256 lastIncreasedTime;
    }

    uint256 public constant BASIS_POINTS_DIVISOR = 10000;
    uint256 public constant ROLLOVER_RATE_PRECISION = 1000000;
    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant MAX_FEE_BASIS_POINTS = 500; // 5%
    uint256 public constant MAX_PROFIT_FEE_BASIS_POINTS = 5000; // 50%
    uint256 public constant MAX_LIQUIDATION_FEE_USD = 100 * PRICE_PRECISION; // 100 USD
    uint256 public constant MIN_ROLLOVER_RATE_INTERVAL = 1 hours;
    uint256 public constant MAX_ROLLOVER_RATE_FACTOR = 10000; // 1%

    bool public override isInitialized;

    IVault public vault;
    address public override gov;

    uint256 public override feeMultiplierIfInactive = 10; // 10x
    bool public override isActive = false;

    uint256 public override liquidationFeeUsd;
    mapping (address => uint256) public override taxBasisPoints;
    mapping (address => uint256) public override mintBurnFeeBasisPoints;
    mapping (address => uint256) public override swapFeeBasisPoints;

    mapping (address => uint256[]) public override relativePnlLists;
    mapping (address => uint256[]) public override positionFeeBasisPointsLists;
    mapping (address => uint256[]) public override profitFeeBasisPointsLists;

    bool public override hasDynamicFees = false;

    uint256 public override rolloverInterval = 8 hours;
    mapping (address => uint256) public override rolloverRateFactors;

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
        require(isInitialized, "FeeUtilsV2: not initialized yet");
        _;
    }

    function initialize(
        uint256 _liquidationFeeUsd,
        bool _hasDynamicFees
    ) external {
        _onlyGov();
        require(!isInitialized, "FeeUtilsV2: already initialized");

        isInitialized = true;

        liquidationFeeUsd = _liquidationFeeUsd;
        hasDynamicFees = _hasDynamicFees;
    }

    function setGov(address _gov) external {
        _onlyGov();
        gov = _gov;
    }

    function setFeeMultiplierIfInactive(uint256 _feeMultiplierIfInactive) external override {
        _onlyGov();
        require(_feeMultiplierIfInactive >= 1, "FeeUtilsV2: invalid _feeMultiplierIfInactive");
        feeMultiplierIfInactive = _feeMultiplierIfInactive;
    }

    function setIsActive(bool _isActive) external override afterInitialized {
        _onlyGov();
        isActive = _isActive;
    }

    function setLiquidationFeeUsd(uint256 _liquidationFeeUsd) external override {
        _onlyGov();
        require(
            _liquidationFeeUsd <= MAX_LIQUIDATION_FEE_USD,
            "FeeUtilsV2: invalid _liquidationFeeUsd"
        );

        liquidationFeeUsd = _liquidationFeeUsd;
    }

    function setHasDynamicFees(bool _hasDynamicFees) external override {
        _onlyGov();

        hasDynamicFees = _hasDynamicFees;
    }

    function setTokenFeeFactors(
        address _token,
        uint256 _taxBasisPoints,
        uint256 _mintBurnFeeBasisPoints,
        uint256 _swapFeeBasisPoints,
        uint256 _rolloverRateFactor,
        uint256[] memory _relativePnlList,
        uint256[] memory _positionFeeBpsList,
        uint256[] memory _profitFeeBpsList
    ) external override {
        _onlyGov();

        require(
            _taxBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV2: invalid _taxBasisPoints"
        );
        require(
            _mintBurnFeeBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV2: invalid _mintBurnFeeBasisPoints"
        );
        require(
            _swapFeeBasisPoints <= MAX_FEE_BASIS_POINTS,
            "FeeUtilsV2: invalid _swapFeeBasisPoints"
        );
        require(
            _rolloverRateFactor <= MAX_ROLLOVER_RATE_FACTOR,
            "FeeUtilsV2: invalid _rolloverRateFactor"
        );

        require(
            _relativePnlList.length == _positionFeeBpsList.length && _relativePnlList.length == _profitFeeBpsList.length,
            "FeeUtilsV2: invalid _relativePnlList, _positionFeeBpsList, _profitFeeBpsList"
        );

        for (uint256 i = 0; i < _relativePnlList.length; i ++) {
            require(i == 0 || _relativePnlList[i - 1] <= _relativePnlList[i], "FeeUtilsV2: invalid _relativePnlList");
            require(_positionFeeBpsList[i] <= MAX_FEE_BASIS_POINTS, "FeeUtilsV2: invalid _positionFeeBpsList");
            require(_profitFeeBpsList[i] <= MAX_PROFIT_FEE_BASIS_POINTS, "FeeUtilsV2: invalid _profitFeeBpsList");
        }

        taxBasisPoints[_token] = _taxBasisPoints;
        mintBurnFeeBasisPoints[_token] = _mintBurnFeeBasisPoints;
        swapFeeBasisPoints[_token] = _swapFeeBasisPoints;
        rolloverRateFactors[_token] = _rolloverRateFactor;
        relativePnlLists[_token] = _relativePnlList;
        positionFeeBasisPointsLists[_token] = _positionFeeBpsList;
        profitFeeBasisPointsLists[_token] = _profitFeeBpsList;
    }

    function getLiquidationFeeUsd() external override view afterInitialized returns (uint256) {
        return liquidationFeeUsd;
    }

    function getBaseIncreasePositionFeeBps(address /* _indexToken */) external override view afterInitialized returns(uint256) {
        return 0;
    }

    function getBaseDecreasePositionFeeBps(address _indexToken) external override view afterInitialized returns(uint256) {
        if (positionFeeBasisPointsLists[_indexToken].length > 0) {
            return positionFeeBasisPointsLists[_indexToken][0];
        }
        return 0;
    }

    function setRolloverInterval(uint256 _rolloverInterval) external override {
        _onlyGov();
        require(
            _rolloverInterval >= MIN_ROLLOVER_RATE_INTERVAL,
            "FeeUtilsV2: invalid _rolloverInterval"
        );
        rolloverInterval = _rolloverInterval;
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

        uint256 _rolloverRateFactor = rolloverRateFactors[_token];

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

            uint256 rolloverRate = rolloverRateFactors[token];
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

        uint256 rolloverRate = cumulativeRolloverRates[_collateralToken] < _entryRolloverRate
            ? 0
            : cumulativeRolloverRates[_collateralToken].sub(_entryRolloverRate);

        if (rolloverRate == 0) {
            return 0;
        }

        uint256 multiplier = isActive ? 1 : feeMultiplierIfInactive;

        return _size.mul(rolloverRate).mul(multiplier).div(ROLLOVER_RATE_PRECISION);
    }

    function getIncreasePositionFee(
        address /* _account */,
        address /* _collateralToken */,
        address _indexToken,
        bool /* _isLong */,
        uint256 _sizeDelta
    ) external view override afterInitialized returns (uint256) {
        require(isInitialized, "FeeUtilsV2: not initialized yet");

        if (_sizeDelta == 0 || isActive || positionFeeBasisPointsLists[_indexToken].length == 0) {
            return 0;
        }

        uint256 len = positionFeeBasisPointsLists[_indexToken].length;

        uint256 positionFeeBps = positionFeeBasisPointsLists[_indexToken][len - 1];

        uint256 afterFeeUsd = _sizeDelta
            .mul(BASIS_POINTS_DIVISOR.sub(positionFeeBps))
            .div(BASIS_POINTS_DIVISOR);

        return _sizeDelta.sub(afterFeeUsd).mul(feeMultiplierIfInactive);
    }

    function getDecreasePositionFee(
        address _account,
        address _collateralToken,
        address _indexToken,
        bool _isLong,
        uint256 _sizeDelta
    ) external view override afterInitialized returns (uint256) {
        require(isInitialized, "FeeUtilsV2: not initialized yet");

        if (_sizeDelta == 0) {
            return 0;
        }

        bool hasProfit;
        uint256 pnl;

        // scope variables to avoid stack too deep errors
        {
            Position memory position = getPosition(_account, _collateralToken, _indexToken, _isLong);
            (bool _hasProfit, uint256 delta) = vault.getPositionDelta(_account, _collateralToken, _indexToken, _isLong);
            hasProfit = _hasProfit;
            // get the proportional change in pnl
            pnl = _sizeDelta.mul(delta).div(position.size);
        }

        uint256 positionFeeBps;
        uint256 profitFeeBps;

        uint256[] memory relativePnlList = relativePnlLists[_indexToken];
        uint256[] memory positionFeeBpsList = positionFeeBasisPointsLists[_indexToken];
        uint256[] memory profitFeeBpsList = profitFeeBasisPointsLists[_indexToken];

        if (!hasProfit || pnl == 0) {
            positionFeeBps = positionFeeBpsList[0];
            profitFeeBps = 0;
        } else {
            uint256 relativePnl = pnl.mul(BASIS_POINTS_DIVISOR).div(_sizeDelta);

            uint256 len = relativePnlList.length;
            if (relativePnl >= relativePnlList[len - 1]) {
                positionFeeBps = positionFeeBpsList[len - 1];
                profitFeeBps = profitFeeBpsList[len - 1];
            } else {
                for (uint256 i = 1; i < len; i++) {
                    if (relativePnl < relativePnlList[i]) {
                        uint256 minRelativePnl = relativePnlList[i - 1];
                        uint256 maxRelativePnl = relativePnlList[i];
                        uint256 minPositionFeeBps = positionFeeBpsList[i - 1];
                        uint256 maxPositionFeeBps = positionFeeBpsList[i];
                        uint256 minProfitFeeBps = profitFeeBpsList[i - 1];
                        uint256 maxProfitFeeBps = profitFeeBpsList[i];

                        positionFeeBps = minPositionFeeBps.add(
                            (maxPositionFeeBps - minPositionFeeBps).mul(relativePnl - minRelativePnl).div(maxRelativePnl - minRelativePnl)
                        );

                        profitFeeBps = minProfitFeeBps.add(
                            (maxProfitFeeBps - minProfitFeeBps).mul(relativePnl - minRelativePnl).div(maxRelativePnl - minRelativePnl)
                        );

                        break;
                    }
                }
            }
        }

        uint256 fees = (_sizeDelta.mul(positionFeeBps).add(pnl.mul(profitFeeBps))).div(BASIS_POINTS_DIVISOR);

        uint256 multiplier = isActive ? 1 : feeMultiplierIfInactive;

        return fees.mul(multiplier);
    }

    function getBuyUsdfFeeBasisPoints(
        address _token,
        uint256 _usdfAmount
    ) public view override afterInitialized returns (uint256) {
        return getFeeBasisPoints(
            _token,
            _usdfAmount,
            mintBurnFeeBasisPoints[_token],
            taxBasisPoints[_token],
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
            mintBurnFeeBasisPoints[_token],
            taxBasisPoints[_token],
            false
        );
    }

    function getSwapFeeBasisPoints(
        address _tokenIn,
        address _tokenOut,
        uint256 _usdfAmount
    ) public view override afterInitialized returns (uint256) {
        uint256 feesBasisPoints0 = getFeeBasisPoints(
            _tokenIn,
            _usdfAmount,
            swapFeeBasisPoints[_tokenIn],
            taxBasisPoints[_tokenIn],
            true
        );
        uint256 feesBasisPoints1 = getFeeBasisPoints(
            _tokenOut,
            _usdfAmount,
            swapFeeBasisPoints[_tokenOut],
            taxBasisPoints[_tokenOut],
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
            uint256 rebateBps = _taxBasisPoints.mul(initialDiff).div(targetAmount);
            return rebateBps > feeBps ? 0 : feeBps.sub(rebateBps);
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
        require(msg.sender == gov, "FeeUtilsV2: forbidden");
    }

    function getStates(address[] memory _tokens) external view returns (
        address[] memory,
        uint256[] memory,
        bool[] memory
    ) {
        uint256 totalLength = 0;
        for (uint256 i = 0; i < _tokens.length; i++) {
            totalLength += 5 + 3 * relativePnlLists[_tokens[i]].length;
        }

        address[] memory addressValues = new address[](2);
        uint256[] memory intValues = new uint256[](3 + totalLength);
        bool[] memory boolValues = new bool[](2);

        addressValues[0] = gov;
        addressValues[1] = address(vault);

        intValues[0] = liquidationFeeUsd;
        intValues[1] = rolloverInterval;
        intValues[2] = feeMultiplierIfInactive;

        boolValues[0] = hasDynamicFees;
        boolValues[1] = isActive;

        uint256 index = 3;
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];

            intValues[index] = taxBasisPoints[token];
            intValues[index + 1] = mintBurnFeeBasisPoints[token];
            intValues[index + 2] = swapFeeBasisPoints[token];
            intValues[index + 3] = rolloverRateFactors[token];
            intValues[index + 4] = relativePnlLists[token].length;
            index += 5;
            for (uint256 j = 0; j < relativePnlLists[token].length; j++) {
                intValues[index] = relativePnlLists[token][j];
                intValues[index + 1] = positionFeeBasisPointsLists[token][j];
                intValues[index + 2] = profitFeeBasisPointsLists[token][j];
                index += 3;
            }
        }

        return (
            addressValues,
            intValues,
            boolValues
        );
    }

    function getPosition(address _account, address _collateralToken, address _indexToken, bool _isLong) internal view returns (Position memory) {
        IVault _vault = vault;
        Position memory position;
        {
            (uint256 size, uint256 collateral, uint256 averagePrice, uint256 entryRolloverRate, /* reserveAmount */, /* realisedPnl */, /* hasProfit */, uint256 lastIncreasedTime) = _vault.getPosition(_account, _collateralToken, _indexToken, _isLong);
            position.size = size;
            position.collateral = collateral;
            position.averagePrice = averagePrice;
            position.entryRolloverRate = entryRolloverRate;
            position.lastIncreasedTime = lastIncreasedTime;
        }
        return position;
    }
}
