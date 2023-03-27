const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd } = require("../shared/units")
const { initVault, getBnbConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("FeeUtilsV1", function () {
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

  it("inits", async () => {
    expect(await feeUtils.taxBasisPoints()).eq(50)
    expect(await feeUtils.stableTaxBasisPoints()).eq(10)
    expect(await feeUtils.mintBurnFeeBasisPoints()).eq(20)
    expect(await feeUtils.swapFeeBasisPoints()).eq(30)
    expect(await feeUtils.stableSwapFeeBasisPoints()).eq(4)
    expect(await feeUtils.marginFeeBasisPoints()).eq(10)
    expect(await feeUtils.liquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtils.hasDynamicFees()).to.be.true
    expect(await feeUtils.feeMultiplierIfInactive()).eq(1)
    expect(await feeUtils.isActive()).to.be.false

    expect(await feeUtils.getLiquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtils.getBaseIncreasePositionFeeBps(bnb.address)).eq(10)
    expect(await feeUtils.getBaseDecreasePositionFeeBps(bnb.address)).eq(10)
  })

  it("setGov", async () => {
    await expect(feeUtils.connect(user0).setGov(user1.address))
      .to.be.revertedWith("FeeUtilsV1: forbidden")

    expect(await feeUtils.gov()).eq(wallet.address)

    await feeUtils.setGov(user0.address)
    expect(await feeUtils.gov()).eq(user0.address)

    await feeUtils.connect(user0).setGov(user1.address)
    expect(await feeUtils.gov()).eq(user1.address)
  })

  it("setFeeMultiplierIfInactive", async () => {
    await expect(feeUtils.connect(user0).setFeeMultiplierIfInactive(user1.address))
      .to.be.revertedWith("FeeUtilsV1: forbidden")

    expect(await feeUtils.feeMultiplierIfInactive()).eq(1)

    await feeUtils.setFeeMultiplierIfInactive(10)
    expect(await feeUtils.feeMultiplierIfInactive()).eq(10)

    await feeUtils.setGov(user0.address)

    await feeUtils.connect(user0).setFeeMultiplierIfInactive(20)
    expect(await feeUtils.feeMultiplierIfInactive()).eq(20)
  })

  it("setIsActive", async () => {
    await expect(feeUtils.connect(user0).setIsActive(true))
      .to.be.revertedWith("FeeUtilsV1: forbidden")

    expect(await feeUtils.isActive()).to.be.false

    await feeUtils.setIsActive(true)
    expect(await feeUtils.isActive()).to.be.true

    await feeUtils.setGov(user0.address)

    await feeUtils.connect(user0).setIsActive(false)
    expect(await feeUtils.isActive()).to.be.false
  })

  it("setFees", async () => {
    await expect(feeUtils.connect(user0).setFees(
      1, // _taxBasisPoints,
      2, // _stableTaxBasisPoints,
      3, // _mintBurnFeeBasisPoints,
      4, // _swapFeeBasisPoints,
      5, // _stableSwapFeeBasisPoints,
      6, // _marginFeeBasisPoints,
      7, // _liquidationFeeUsd,
      false
    )).to.be.revertedWith("FeeUtilsV1: forbidden")

    expect(await feeUtils.taxBasisPoints()).eq(50)
    expect(await feeUtils.stableTaxBasisPoints()).eq(10)
    expect(await feeUtils.mintBurnFeeBasisPoints()).eq(20)
    expect(await feeUtils.swapFeeBasisPoints()).eq(30)
    expect(await feeUtils.stableSwapFeeBasisPoints()).eq(4)
    expect(await feeUtils.marginFeeBasisPoints()).eq(10)
    expect(await feeUtils.liquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtils.hasDynamicFees()).eq(true)

    await feeUtils.setFees(
      1, // _taxBasisPoints,
      2, // _stableTaxBasisPoints,
      3, // _mintBurnFeeBasisPoints,
      4, // _swapFeeBasisPoints,
      5, // _stableSwapFeeBasisPoints,
      6, // _marginFeeBasisPoints,
      7, // _liquidationFeeUsd,
      false // _hasDynamicFees
    )

    expect(await feeUtils.taxBasisPoints()).eq(1)
    expect(await feeUtils.stableTaxBasisPoints()).eq(2)
    expect(await feeUtils.mintBurnFeeBasisPoints()).eq(3)
    expect(await feeUtils.swapFeeBasisPoints()).eq(4)
    expect(await feeUtils.stableSwapFeeBasisPoints()).eq(5)
    expect(await feeUtils.marginFeeBasisPoints()).eq(6)
    expect(await feeUtils.liquidationFeeUsd()).eq(7)
    expect(await feeUtils.hasDynamicFees()).eq(false)

    await feeUtils.setGov(user0.address);

    await feeUtils.connect(user0).setFees(
      11, // _taxBasisPoints,
      12, // _stableTaxBasisPoints,
      13, // _mintBurnFeeBasisPoints,
      14, // _swapFeeBasisPoints,
      15, // _stableSwapFeeBasisPoints,
      16, // _marginFeeBasisPoints,
      17, // _liquidationFeeUsd,
      true // _hasDynamicFees
    )

    expect(await feeUtils.taxBasisPoints()).eq(11)
    expect(await feeUtils.stableTaxBasisPoints()).eq(12)
    expect(await feeUtils.mintBurnFeeBasisPoints()).eq(13)
    expect(await feeUtils.swapFeeBasisPoints()).eq(14)
    expect(await feeUtils.stableSwapFeeBasisPoints()).eq(15)
    expect(await feeUtils.marginFeeBasisPoints()).eq(16)
    expect(await feeUtils.liquidationFeeUsd()).eq(17)
    expect(await feeUtils.hasDynamicFees()).eq(true)
  })

  it("setRolloverRate", async () => {
    await expect(feeUtils.connect(user0).setRolloverRate(59 * 60, 100, 100))
      .to.be.revertedWith("FeeUtilsV1: forbidden")

    await expect(feeUtils.setRolloverRate(59 * 60, 100, 100))
      .to.be.revertedWith("FeeUtilsV1: invalid _rolloverInterval")

    expect(await feeUtils.rolloverRateFactor()).eq(600)
    expect(await feeUtils.stableRolloverRateFactor()).eq(600)
    await feeUtils.setRolloverRate(60 * 60, 0, 100)
    expect(await feeUtils.rolloverRateFactor()).eq(0)
    expect(await feeUtils.stableRolloverRateFactor()).eq(100)

    await feeUtils.setRolloverRate(60 * 60, 100, 0)
    expect(await feeUtils.rolloverInterval()).eq(60 * 60)
    expect(await feeUtils.rolloverRateFactor()).eq(100)
    expect(await feeUtils.stableRolloverRateFactor()).eq(0)

    await feeUtils.setGov(user0.address)

    await feeUtils.connect(user0).setRolloverRate(120 * 60, 50, 75)
    expect(await feeUtils.rolloverInterval()).eq(120 * 60)
    expect(await feeUtils.rolloverRateFactor()).eq(50)
    expect(await feeUtils.stableRolloverRateFactor()).eq(75)
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
