const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance } = require("./helpers")

use(solidity)

describe("Vault.getFeeBasisPoints", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let feeUtils
  let vaultPriceFeed
  let usdf
  let router
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let dai
  let daiPriceFeed
  let distributor0
  let yieldTracker0

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])

    const initVaultResult = await initVault(vault, router, usdf, vaultPriceFeed)
    feeUtils = initVaultResult.feeUtils

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdf.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdf.setYieldTrackers([yieldTracker0.address])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await vault.setMinProfitTime(0)
    await feeUtils.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      20, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      true // _hasDynamicFees
    )
  })

  it("getFeeBasisPoints", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(0)

    await bnb.mint(vault.address, 100)
    await vault.connect(user0).buyUSDF(bnb.address, wallet.address)

    expect(await vault.usdfAmounts(bnb.address)).eq(29700)
    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(29700)

    // usdfAmount(bnb) is 29700, targetAmount(bnb) is 29700
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(100)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(104)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(100)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(104)

    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 50, 100, true)).eq(51)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 50, 100, true)).eq(58)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 50, 100, false)).eq(51)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 50, 100, false)).eq(58)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(14850)
    expect(await vault.getTargetUsdfAmount(dai.address)).eq(14850)

    // usdfAmount(bnb) is 29700, targetAmount(bnb) is 14850
    // incrementing bnb has an increased fee, while reducing bnb has a decreased fee
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 10000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 20000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(50)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(50)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 10000, 100, 50, false)).eq(50)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 20000, 100, 50, false)).eq(50)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 25000, 100, 50, false)).eq(50)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 100000, 100, 50, false)).eq(150)

    await dai.mint(vault.address, 20000)
    await vault.connect(user0).buyUSDF(dai.address, wallet.address)

    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(24850)
    expect(await vault.getTargetUsdfAmount(dai.address)).eq(24850)

    const bnbConfig = getBnbConfig(bnb, bnbPriceFeed)
    bnbConfig[2] = 30000
    await vault.setTokenConfig(...bnbConfig)

    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(37275)
    expect(await vault.getTargetUsdfAmount(dai.address)).eq(12425)

    expect(await vault.usdfAmounts(bnb.address)).eq(29700)

    // usdfAmount(bnb) is 29700, targetAmount(bnb) is 37270
    // incrementing bnb has a decreased fee, while reducing bnb has an increased fee
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(90)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(90)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 10000, 100, 50, true)).eq(90)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(110)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(113)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 10000, 100, 50, false)).eq(116)

    bnbConfig[2] = 5000
    await vault.setTokenConfig(...bnbConfig)

    await bnb.mint(vault.address, 200)
    await vault.connect(user0).buyUSDF(bnb.address, wallet.address)

    expect(await vault.usdfAmounts(bnb.address)).eq(89100)
    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(36366)
    expect(await vault.getTargetUsdfAmount(dai.address)).eq(72733)

    // usdfAmount(bnb) is 88800, targetAmount(bnb) is 36266
    // incrementing bnb has an increased fee, while reducing bnb has a decreased fee
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 10000, 100, 50, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(28)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(28)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 20000, 100, 50, false)).eq(28)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 50000, 100, 50, false)).eq(28)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 80000, 100, 50, false)).eq(28)

    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 50, 100, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 50, 100, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 10000, 50, 100, true)).eq(150)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 1000, 50, 100, false)).eq(0)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 5000, 50, 100, false)).eq(0)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 20000, 50, 100, false)).eq(0)
    expect(await feeUtils.getFeeBasisPoints(bnb.address, 50000, 50, 100, false)).eq(0)
  })
})
