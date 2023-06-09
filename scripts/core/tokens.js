// price feeds https://docs.chain.link/docs/binance-smart-chain-addresses/

module.exports = {
  optimismGoerli: {
    // https://docs.chain.link/docs/data-feeds/price-feeds/addresses/
    btcPriceFeed: { address: "0xC16679B963CeB52089aD2d95312A5b85E318e9d2" },
    ethPriceFeed: { address: "0x57241A37733983F97C4Ab06448F244A1E0Ca0ba8" },
    usdtPriceFeed: { address: "0x2e2147bCd571CE816382485E59Cd145A2b7CA451" },
    usdcPriceFeed: { address: "0x2636B223652d388721A0ED2861792DA9062D8C73" },
    btc: {
      name: "btc",
      address: "0x3491d4649aeBC9f46370DFF87c9887f557fb5954",
      decimals: 18,
      priceFeed: "0xC16679B963CeB52089aD2d95312A5b85E318e9d2",
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 27000,
      minProfitBps: 0,
      maxUsdfAmount: 50 * 1000 * 1000,
      bufferAmount: 450,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 30 * 1000 * 1000,
      taxBasisPoints: 60, // 0.6%
      mintBurnFeeBasisPoints: 25, // 0.25%
      swapFeeBasisPoints: 25, // 0.25%
      rolloverRateFactor: 100,
      relativePnlList: [0, 25, 50, 100, 1000, 5000],
      positionFeeBpsList: [15, 15, 20, 30, 50, 100],
      profitFeeBpsList: [500, 500, 500, 500, 500, 1000],
      faucetAmount: 0.004,
    },
    eth: {
      name: "eth",
      address: "0x5088964b5174E7DEe70a5343066f6a6Ac5ca71Fc",
      decimals: 18,
      priceFeed: "0x57241A37733983F97C4Ab06448F244A1E0Ca0ba8",
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 28000,
      minProfitBps: 0,
      maxUsdfAmount: 120 * 1000 * 1000,
      bufferAmount: 15000,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 30 * 1000 * 1000,
      taxBasisPoints: 60, // 0.6%
      mintBurnFeeBasisPoints: 25, // 0.25%
      swapFeeBasisPoints: 25, // 0.25%
      rolloverRateFactor: 100,
      relativePnlList: [0, 25, 50, 100, 1000, 5000],
      positionFeeBpsList: [15, 15, 20, 30, 50, 100],
      profitFeeBpsList: [500, 500, 500, 500, 500, 1000],
      faucetAmount: 0.05,
    },
    feth: {
      name: "feth",
      address: "0x5550c5F3E75611d97A8D048A4Af1a88a4e3329Ed",
      decimals: 18,
      priceFeed: "0x57241A37733983F97C4Ab06448F244A1E0Ca0ba8",
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 28000,
      minProfitBps: 0,
      maxUsdfAmount: 120 * 1000 * 1000,
      bufferAmount: 15000,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 30 * 1000 * 1000,
      taxBasisPoints: 60, // 0.6%
      mintBurnFeeBasisPoints: 25, // 0.25%
      swapFeeBasisPoints: 25, // 0.25%
      rolloverRateFactor: 100,
      relativePnlList: [0, 25, 50, 100, 1000, 5000],
      positionFeeBpsList: [15, 15, 20, 30, 50, 100],
      profitFeeBpsList: [500, 500, 500, 500, 500, 1000],
      faucetAmount: 0.05,
    },
    usdc: {
      name: "usdc",
      address: "0xD1D57Fd32AE51eB778730d4C740E8C041891F525",
      decimals: 18,
      priceFeed: "0x2636B223652d388721A0ED2861792DA9062D8C73",
      priceDecimals: 8,
      isStrictStable: true,
      tokenWeight: 32000,
      minProfitBps: 0,
      maxUsdfAmount: 120 * 1000 * 1000,
      bufferAmount: 60 * 1000 * 1000,
      isStable: true,
      isShortable: false,
      taxBasisPoints: 5, // 0.05%
      mintBurnFeeBasisPoints: 25, // 0.25%
      swapFeeBasisPoints: 1, // 0.01%
      rolloverRateFactor: 100,
      relativePnlList: [],
      positionFeeBpsList: [],
      profitFeeBpsList: [],
      faucetAmount: 100,
    },
    usdt: {
      name: "usdt",
      address: "0x169E3A9F6b76Ad6b3149F1d30d3Ab4d4D6f3EecC",
      decimals: 18,
      priceFeed: "0x2e2147bCd571CE816382485E59Cd145A2b7CA451",
      priceDecimals: 8,
      isStrictStable: true,
      tokenWeight: 3000,
      minProfitBps: 0,
      maxUsdfAmount: 10 * 1000 * 1000,
      bufferAmount: 4 * 1000 * 1000,
      isStable: true,
      isShortable: false,
      taxBasisPoints: 5, // 0.05%
      mintBurnFeeBasisPoints: 25, // 0.25%
      swapFeeBasisPoints: 1, // 0.01%
      rolloverRateFactor: 100,
      relativePnlList: [],
      positionFeeBpsList: [],
      profitFeeBpsList: [],
      faucetAmount: 100,
    },
    nativeToken: {
      name: "weth",
      address: "0x5088964b5174E7DEe70a5343066f6a6Ac5ca71Fc",
      decimals: 18
    }
  },
  optimism: {
    btc: {
      name: "btc",
      address: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
      decimals: 8,
      priceFeed: "0x718A5788b89454aAE3A028AE9c111A29Be6c2a6F",
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 80 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 20000,
      minProfitBps: 0,
      maxUsdfAmount: 50 * 1000 * 1000,
      bufferAmount: 450,
      isStable: false,
      isShortable: true,
      // maxGlobalShortSize: 30 * 1000 * 1000,
      maxGlobalShortSize: 5000,
      maxGlobalLongSize: 5000,
      taxBasisPoints: 0, // 0%
      mintBurnFeeBasisPoints: 30, // 0.3%
      swapFeeBasisPoints: 25, // 0.25%
      rolloverRateFactor: 0,
      relativePnlList: [0, 1000, 5000],
      positionFeeBpsList: [0, 0, 0],
      profitFeeBpsList: [500, 500, 1000],
      faucetAmount: 0.004,
    },
    eth: {
      name: "eth",
      address: "0xD158B0F013230659098e58b66b602dFF8f7ff120",
      decimals: 18,
      priceFeed: "0x13e3Ee699D1909E989722E753853AE30b17e08c5",
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 30000,
      minProfitBps: 0,
      maxUsdfAmount: 120 * 1000 * 1000,
      bufferAmount: 15000,
      isStable: false,
      isShortable: true,
      // maxGlobalShortSize: 30 * 1000 * 1000,
      maxGlobalShortSize: 5000,
      maxGlobalLongSize: 5000,
      taxBasisPoints: 0, // 0%
      mintBurnFeeBasisPoints: 30, // 0.3%
      swapFeeBasisPoints: 25, // 0.25%
      rolloverRateFactor: 0,
      relativePnlList: [0, 1000, 5000],
      positionFeeBpsList: [0, 0, 0],
      profitFeeBpsList: [500, 500, 1000],
      faucetAmount: 0.05,
    },
    usdc: {
      name: "usdc",
      address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
      decimals: 6,
      priceFeed: "0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3",
      priceDecimals: 8,
      isStrictStable: true,
      tokenWeight: 30000,
      minProfitBps: 0,
      maxUsdfAmount: 120 * 1000 * 1000,
      bufferAmount: 60 * 1000 * 1000,
      isStable: true,
      isShortable: false,
      taxBasisPoints: 0, // 0.00%
      mintBurnFeeBasisPoints: 30, // 0.3%
      swapFeeBasisPoints: 1, // 0.01%
      rolloverRateFactor: 0,
      relativePnlList: [],
      positionFeeBpsList: [],
      profitFeeBpsList: [],
      faucetAmount: 100,
    },
    usdt: {
      name: "usdt",
      address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
      decimals: 6,
      priceFeed: "0xECef79E109e997bCA29c1c0897ec9d7b03647F5E",
      priceDecimals: 8,
      isStrictStable: true,
      tokenWeight: 20000,
      minProfitBps: 0,
      maxUsdfAmount: 80 * 1000 * 1000,
      bufferAmount: 4 * 1000 * 1000,
      isStable: true,
      isShortable: false,
      taxBasisPoints: 0, // 0.0%
      mintBurnFeeBasisPoints: 30, // 0.3%
      swapFeeBasisPoints: 1, // 0.01%
      rolloverRateFactor: 0,
      relativePnlList: [],
      positionFeeBpsList: [],
      profitFeeBpsList: [],
      faucetAmount: 100,
    },
    nativeToken: {
      name: "weth",
      address: "0xD158B0F013230659098e58b66b602dFF8f7ff120",
      decimals: 18
    }
  }
}
