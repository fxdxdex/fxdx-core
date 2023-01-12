// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../core/interfaces/IVault.sol";
import "../core/interfaces/IVaultPriceFeed.sol";
import "../core/interfaces/IBasePositionManager.sol";

contract VaultReader {
    function getVaultTokenInfoV3(address _vault, address _positionManager, address _weth, uint256 _usdfAmount, address[] memory _tokens) public view returns (uint256[] memory) {
        uint256 propsLength = 14;

        IVault vault = IVault(_vault);
        IVaultPriceFeed priceFeed = IVaultPriceFeed(vault.priceFeed());
        IBasePositionManager positionManager = IBasePositionManager(_positionManager);

        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }

            amounts[i * propsLength] = vault.poolAmounts(token);
            amounts[i * propsLength + 1] = vault.reservedAmounts(token);
            amounts[i * propsLength + 2] = vault.usdfAmounts(token);
            amounts[i * propsLength + 3] = vault.getRedemptionAmount(token, _usdfAmount);
            amounts[i * propsLength + 4] = vault.tokenWeights(token);
            amounts[i * propsLength + 5] = vault.bufferAmounts(token);
            amounts[i * propsLength + 6] = vault.maxUsdfAmounts(token);
            amounts[i * propsLength + 7] = vault.globalShortSizes(token);
            amounts[i * propsLength + 8] = positionManager.maxGlobalShortSizes(token);
            amounts[i * propsLength + 9] = vault.getMinPrice(token);
            amounts[i * propsLength + 10] = vault.getMaxPrice(token);
            amounts[i * propsLength + 11] = vault.guaranteedUsd(token);
            amounts[i * propsLength + 12] = priceFeed.getPrimaryPrice(token, false);
            amounts[i * propsLength + 13] = priceFeed.getPrimaryPrice(token, true);
        }

        return amounts;
    }

    function getVaultTokenInfoV4(address _vault, address _positionManager, address _weth, uint256 _usdfAmount, address[] memory _tokens) public view returns (uint256[] memory) {
        uint256 propsLength = 15;

        IVault vault = IVault(_vault);
        IVaultPriceFeed priceFeed = IVaultPriceFeed(vault.priceFeed());
        IBasePositionManager positionManager = IBasePositionManager(_positionManager);

        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }

            amounts[i * propsLength] = vault.poolAmounts(token);
            amounts[i * propsLength + 1] = vault.reservedAmounts(token);
            amounts[i * propsLength + 2] = vault.usdfAmounts(token);
            amounts[i * propsLength + 3] = vault.getRedemptionAmount(token, _usdfAmount);
            amounts[i * propsLength + 4] = vault.tokenWeights(token);
            amounts[i * propsLength + 5] = vault.bufferAmounts(token);
            amounts[i * propsLength + 6] = vault.maxUsdfAmounts(token);
            amounts[i * propsLength + 7] = vault.globalShortSizes(token);
            amounts[i * propsLength + 8] = positionManager.maxGlobalShortSizes(token);
            amounts[i * propsLength + 9] = positionManager.maxGlobalLongSizes(token);
            amounts[i * propsLength + 10] = vault.getMinPrice(token);
            amounts[i * propsLength + 11] = vault.getMaxPrice(token);
            amounts[i * propsLength + 12] = vault.guaranteedUsd(token);
            amounts[i * propsLength + 13] = priceFeed.getPrimaryPrice(token, false);
            amounts[i * propsLength + 14] = priceFeed.getPrimaryPrice(token, true);
        }

        return amounts;
    }

    function getVaultTokenInfoV5(address _vault, address _positionManager, address _weth, uint256 _usdfAmount, address[] memory _tokens) public view returns (uint256[] memory) {
        uint256 propsLength = 17;

        IVault vault = IVault(_vault);
        IVaultPriceFeed priceFeed = IVaultPriceFeed(vault.priceFeed());
        IBasePositionManager positionManager = IBasePositionManager(_positionManager);

        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }

            amounts[i * propsLength] = vault.poolAmounts(token);
            amounts[i * propsLength + 1] = vault.reservedAmounts(token);
            amounts[i * propsLength + 2] = vault.usdfAmounts(token);
            amounts[i * propsLength + 3] = vault.getRedemptionAmount(token, _usdfAmount);
            amounts[i * propsLength + 4] = vault.tokenWeights(token);
            amounts[i * propsLength + 5] = vault.bufferAmounts(token);
            amounts[i * propsLength + 6] = vault.maxUsdfAmounts(token);
            amounts[i * propsLength + 7] = vault.globalShortSizes(token);
            amounts[i * propsLength + 8] = positionManager.maxGlobalShortSizes(token);
            amounts[i * propsLength + 9] = positionManager.maxGlobalLongSizes(token);
            amounts[i * propsLength + 10] = vault.getMinPrice(token);
            amounts[i * propsLength + 11] = vault.getMaxPrice(token);
            amounts[i * propsLength + 12] = vault.guaranteedUsd(token);
            amounts[i * propsLength + 13] = priceFeed.getPrimaryPrice(token, false);
            amounts[i * propsLength + 14] = priceFeed.getPrimaryPrice(token, true);
            amounts[i * propsLength + 15] = priceFeed.spreadBasisPoints(token);
            amounts[i * propsLength + 16] = vault.globalShortAveragePrices(token);
        }

        return amounts;
    }

    function getVaultStates(address _vault, address[] memory _tokens) public view returns (
        address[] memory,
        uint256[] memory,
        bool[] memory
    ) {
        IVault vault = IVault(_vault);

        address[] memory addressValues = new address[](2);
        uint256[] memory intValues = new uint256[](13 + _tokens.length * 7);
        bool[] memory boolValues = new bool[](3 + _tokens.length * 2);

        addressValues[0] = vault.priceFeed();
        addressValues[1] = vault.gov();

        boolValues[0] = vault.isSwapEnabled();
        boolValues[1] = vault.hasDynamicFees();
        boolValues[2] = vault.inPrivateLiquidationMode();

        intValues[0] = vault.maxLeverage();
        intValues[1] = vault.liquidationFeeUsd();
        intValues[2] = vault.taxBasisPoints();
        intValues[3] = vault.stableTaxBasisPoints();
        intValues[4] = vault.mintBurnFeeBasisPoints();
        intValues[5] = vault.swapFeeBasisPoints();
        intValues[6] = vault.stableSwapFeeBasisPoints();
        intValues[7] = vault.marginFeeBasisPoints();
        intValues[8] = vault.minProfitTime();
        intValues[9] = vault.fundingInterval();
        intValues[10] = vault.fundingRateFactor();
        intValues[11] = vault.stableFundingRateFactor();
        intValues[12] = vault.maxGasPrice();

        uint256 intValuesLength = 7;
        uint256 boolValuesLength = 2;

        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];

            intValues[intValuesLength * i + 13] = vault.tokenDecimals(token);
            intValues[intValuesLength * i + 14] = vault.minProfitBasisPoints(token);

            intValues[intValuesLength * i + 15] = vault.tokenWeights(token);
            intValues[intValuesLength * i + 16] = vault.usdfAmounts(token);
            intValues[intValuesLength * i + 17] = vault.maxUsdfAmounts(token);
            intValues[intValuesLength * i + 18] = vault.bufferAmounts(token);

            intValues[intValuesLength * i + 19] = vault.maxGlobalShortSizes(token);

            boolValues[boolValuesLength * i + 3] = vault.stableTokens(token);
            boolValues[boolValuesLength * i + 4] = vault.shortableTokens(token);
        }

        return (
            addressValues,
            intValues,
            boolValues
        );
    }
}
