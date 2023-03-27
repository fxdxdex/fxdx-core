const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd } = require("../shared/units")
const { initVault, getBtcConfig, getDaiConfig, getBnbConfig } = require("./Vault/helpers")
const { expandDecimals } = require("../shared/utilities")

use(solidity)

describe("FeeUtilsV2", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let feeUtilsV2
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

    const { vaultUtils } = await initVault(vault, router, usdf, vaultPriceFeed)

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdf.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdf.setYieldTrackers([yieldTracker0.address])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await vaultPriceFeed.setPriceSampleSpace(1)

    await vault.setMinProfitTime(0)

    feeUtilsV2 = await deployContract("FeeUtilsV2", [vault.address])
    await feeUtilsV2.initialize(toUsd(5), true)

    await vault.setFeeUtils(feeUtilsV2.address)
    await vaultUtils.setFeeUtils(feeUtilsV2.address)

    await feeUtilsV2.setTokenFeeFactors(
      bnb.address,
      50, // _taxBasisPoints
      20, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      600, // rolloverRateFactor
      [0, 850], // relativePnlList
      [15, 100], // positionFeeBpsList
      [150, 1000], // profitFeeBpsList
    )
  })

  it("inits", async () => {
    expect(await feeUtilsV2.taxBasisPoints(bnb.address)).eq(50)
    expect(await feeUtilsV2.mintBurnFeeBasisPoints(bnb.address)).eq(20)
    expect(await feeUtilsV2.swapFeeBasisPoints(bnb.address)).eq(30)
    expect(await feeUtilsV2.rolloverRateFactors(bnb.address)).eq(600)
    expect(await feeUtilsV2.liquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtilsV2.hasDynamicFees()).to.be.true
    expect(await feeUtilsV2.feeMultiplierIfInactive()).eq(10)
    expect(await feeUtilsV2.isActive()).to.be.false

    expect(await feeUtilsV2.relativePnlLists(bnb.address, 0)).eq(0)
    expect(await feeUtilsV2.relativePnlLists(bnb.address, 1)).eq(850)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 0)).eq(15)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 1)).eq(100)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 0)).eq(150)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 1)).eq(1000)

    expect(await feeUtilsV2.getLiquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtilsV2.getBaseIncreasePositionFeeBps(bnb.address)).eq(0)
    expect(await feeUtilsV2.getBaseDecreasePositionFeeBps(bnb.address)).eq(15)
  })

  it("setGov", async () => {
    await expect(feeUtilsV2.connect(user0).setGov(user1.address))
      .to.be.revertedWith("FeeUtilsV2: forbidden")

    expect(await feeUtilsV2.gov()).eq(wallet.address)

    await feeUtilsV2.setGov(user0.address)
    expect(await feeUtilsV2.gov()).eq(user0.address)

    await feeUtilsV2.connect(user0).setGov(user1.address)
    expect(await feeUtilsV2.gov()).eq(user1.address)
  })

  it("setFeeMultiplierIfInactive", async () => {
    await expect(feeUtilsV2.connect(user0).setFeeMultiplierIfInactive(user1.address))
      .to.be.revertedWith("FeeUtilsV2: forbidden")

    expect(await feeUtilsV2.feeMultiplierIfInactive()).eq(10)

    await feeUtilsV2.setFeeMultiplierIfInactive(20)
    expect(await feeUtilsV2.feeMultiplierIfInactive()).eq(20)

    await feeUtilsV2.setGov(user0.address)

    await feeUtilsV2.connect(user0).setFeeMultiplierIfInactive(30)
    expect(await feeUtilsV2.feeMultiplierIfInactive()).eq(30)
  })

  it("setIsActive", async () => {
    await expect(feeUtilsV2.connect(user0).setIsActive(true))
      .to.be.revertedWith("FeeUtilsV2: forbidden")

    expect(await feeUtilsV2.isActive()).to.be.false

    await feeUtilsV2.setIsActive(true)
    expect(await feeUtilsV2.isActive()).to.be.true

    await feeUtilsV2.setGov(user0.address)

    await feeUtilsV2.connect(user0).setIsActive(false)
    expect(await feeUtilsV2.isActive()).to.be.false
  })

  it("setLiquidationFeeUsd", async () => {
    await expect(feeUtilsV2.connect(user0).setLiquidationFeeUsd(toUsd(10)))
      .to.be.revertedWith("FeeUtilsV2: forbidden")

    expect(await feeUtilsV2.liquidationFeeUsd()).eq(toUsd(5))

    await feeUtilsV2.setLiquidationFeeUsd(toUsd(10))
    expect(await feeUtilsV2.liquidationFeeUsd()).eq(toUsd(10))

    await feeUtilsV2.setGov(user0.address)

    await feeUtilsV2.connect(user0).setLiquidationFeeUsd(toUsd(20))
    expect(await feeUtilsV2.liquidationFeeUsd()).eq(toUsd(20))
  })

  it("setHasDynamicFees", async () => {
    await expect(feeUtilsV2.connect(user0).setHasDynamicFees(false))
      .to.be.revertedWith("FeeUtilsV2: forbidden")

    expect(await feeUtilsV2.hasDynamicFees()).to.be.true

    await feeUtilsV2.setHasDynamicFees(false)
    expect(await feeUtilsV2.hasDynamicFees()).to.be.false

    await feeUtilsV2.setGov(user0.address)

    await feeUtilsV2.connect(user0).setHasDynamicFees(true)
    expect(await feeUtilsV2.hasDynamicFees()).to.be.true
  })

  it("setTokenFeeFactors", async () => {
    await expect(feeUtilsV2.connect(user0).setTokenFeeFactors(
      bnb.address,
      1, // _taxBasisPoints,
      2, // _mintBurnFeeBasisPoints,
      3, // _swapFeeBasisPoints,
      4, // _rolloverRateFactor
      [5], // _relativePnlList
      [6], // _positionFeeBpsList
      [7] // _profitFeeBpsList
    )).to.be.revertedWith("FeeUtilsV2: forbidden")

    expect(await feeUtilsV2.taxBasisPoints(bnb.address)).eq(50)
    expect(await feeUtilsV2.mintBurnFeeBasisPoints(bnb.address)).eq(20)
    expect(await feeUtilsV2.swapFeeBasisPoints(bnb.address)).eq(30)
    expect(await feeUtilsV2.rolloverRateFactors(bnb.address)).eq(600)

    expect(await feeUtilsV2.relativePnlLists(bnb.address, 0)).eq(0)
    expect(await feeUtilsV2.relativePnlLists(bnb.address, 1)).eq(850)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 0)).eq(15)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 1)).eq(100)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 0)).eq(150)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 1)).eq(1000)

    await feeUtilsV2.setTokenFeeFactors(
      bnb.address,
      1, // _taxBasisPoints,
      2, // _mintBurnFeeBasisPoints,
      3, // _swapFeeBasisPoints,
      4, // _rolloverRateFactor
      [5], // _relativePnlList
      [6], // _positionFeeBpsList
      [7] // _profitFeeBpsList
    )

    expect(await feeUtilsV2.taxBasisPoints(bnb.address)).eq(1)
    expect(await feeUtilsV2.mintBurnFeeBasisPoints(bnb.address)).eq(2)
    expect(await feeUtilsV2.swapFeeBasisPoints(bnb.address)).eq(3)
    expect(await feeUtilsV2.rolloverRateFactors(bnb.address)).eq(4)

    expect(await feeUtilsV2.relativePnlLists(bnb.address, 0)).eq(5)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 0)).eq(6)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 0)).eq(7)

    await feeUtilsV2.setGov(user0.address);

    await feeUtilsV2.connect(user0).setTokenFeeFactors(
      bnb.address,
      8, // _taxBasisPoints,
      9, // _mintBurnFeeBasisPoints,
      10, // _swapFeeBasisPoints,
      11, // _rolloverRateFactor
      [12, 13], // _relativePnlList
      [14, 15], // _positionFeeBpsList
      [16, 17] // _profitFeeBpsList
    )

    expect(await feeUtilsV2.taxBasisPoints(bnb.address)).eq(8)
    expect(await feeUtilsV2.mintBurnFeeBasisPoints(bnb.address)).eq(9)
    expect(await feeUtilsV2.swapFeeBasisPoints(bnb.address)).eq(10)
    expect(await feeUtilsV2.rolloverRateFactors(bnb.address)).eq(11)

    expect(await feeUtilsV2.relativePnlLists(bnb.address, 0)).eq(12)
    expect(await feeUtilsV2.relativePnlLists(bnb.address, 1)).eq(13)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 0)).eq(14)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 1)).eq(15)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 0)).eq(16)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 1)).eq(17)
  })

  it("setRolloverInterval", async () => {
    await expect(feeUtilsV2.connect(user0).setRolloverInterval(59 * 60))
      .to.be.revertedWith("FeeUtilsV2: forbidden")

    await expect(feeUtilsV2.setRolloverInterval(59 * 60))
      .to.be.revertedWith("FeeUtilsV2: invalid _rolloverInterval")

    expect(await feeUtilsV2.rolloverInterval()).eq(8 * 60 * 60)

    await feeUtilsV2.setRolloverInterval(60 * 60)
    expect(await feeUtilsV2.rolloverInterval()).eq(60 * 60)

    await feeUtilsV2.setGov(user0.address)

    await feeUtilsV2.connect(user0).setRolloverInterval(120 * 60)
    expect(await feeUtilsV2.rolloverInterval()).eq(120 * 60)
  })

  it("getIncreasePositionFee", async () => {
    expect(await feeUtilsV2.getIncreasePositionFee(user0.address, dai.address, bnb.address, false, 10000)).eq(1000)

    await feeUtilsV2.setIsActive(true)

    expect(await feeUtilsV2.getIncreasePositionFee(user0.address, dai.address, bnb.address, false, 10000)).eq(0)
  })

  it("getDecreasePositionFee", async () => {
    await feeUtilsV2.setIsActive(true)

    await feeUtilsV2.setTokenFeeFactors(
      btc.address,
      50, // _taxBasisPoints
      20, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      600, // rolloverRateFactor
      [0, 850], // relativePnlList
      [15, 100], // positionFeeBpsList
      [150, 1000], // profitFeeBpsList
    )

    await vault.setMinProfitTime(0)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await dai.mint(user1.address, expandDecimals(1000, 18))
    await dai.connect(user1).transfer(vault.address, expandDecimals(1000, 18)) // 1000 Dai => 1000 USD
    await vault.buyUSDF(dai.address, user1.address)

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 2500000) // 0.0025 BTC => 1000 USD
    await vault.buyUSDF(btc.address, user1.address)

    // long position
    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD

    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(100), true)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(100)) // size
    expect(position[1]).eq(toUsd(10)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate

    let decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      btc.address,
      btc.address,
      true,
      toUsd(100)
    )

    expect(decreasePositionFee).eq(toUsd(0.15))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000 - 100))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      btc.address,
      btc.address,
      true,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(0.15))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40680))
    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(1.7))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      btc.address,
      btc.address,
      true,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(100 * 0.0032 + 1.7 * 0.032))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43400))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(8.5))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      btc.address,
      btc.address,
      true,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(100 * 0.01 + 8.5 * 0.1))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46800))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(17))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      btc.address,
      btc.address,
      true,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(100 * 0.01 + 17 * 0.1))

    // Short position
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await dai.mint(user0.address, expandDecimals(10, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(10, 18)) // 10 Dai => 10 USD

    await vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false)

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(100)) // size
    expect(position[1]).eq(toUsd(10)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      dai.address,
      btc.address,
      false,
      toUsd(100)
    )

    expect(decreasePositionFee).eq(toUsd(0.15))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40100))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      dai.address,
      btc.address,
      false,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(0.15))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39320))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(1.7))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      dai.address,
      btc.address,
      false,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(100 * 0.0032 + 1.7 * 0.032))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(36600))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(8.5))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      dai.address,
      btc.address,
      false,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(100 * 0.01 + 8.5 * 0.1))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(33200))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(17))

    decreasePositionFee = await feeUtilsV2.getDecreasePositionFee(
      user0.address,
      dai.address,
      btc.address,
      false,
      toUsd(100)
    )
    expect(decreasePositionFee).eq(toUsd(100 * 0.01 + 17 * 0.1))
  })

  it("getFeeBasisPoints", async () => {
    await feeUtilsV2.setIsActive(true)

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(0)

    await bnb.mint(vault.address, 100)
    await vault.connect(user0).buyUSDF(bnb.address, wallet.address)

    expect(await vault.usdfAmounts(bnb.address)).eq(29700)
    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(29700)

    // usdfAmount(bnb) is 29700, targetAmount(bnb) is 29700
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(100)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(104)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(100)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(104)

    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 50, 100, true)).eq(51)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 50, 100, true)).eq(58)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 50, 100, false)).eq(51)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 50, 100, false)).eq(58)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(14850)
    expect(await vault.getTargetUsdfAmount(dai.address)).eq(14850)

    // usdfAmount(bnb) is 29700, targetAmount(bnb) is 14850
    // incrementing bnb has an increased fee, while reducing bnb has a decreased fee
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 10000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 20000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(50)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(50)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 10000, 100, 50, false)).eq(50)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 20000, 100, 50, false)).eq(50)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 25000, 100, 50, false)).eq(50)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 100000, 100, 50, false)).eq(150)

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
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(90)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(90)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 10000, 100, 50, true)).eq(90)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(110)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(113)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 10000, 100, 50, false)).eq(116)

    bnbConfig[2] = 5000
    await vault.setTokenConfig(...bnbConfig)

    await bnb.mint(vault.address, 200)
    await vault.connect(user0).buyUSDF(bnb.address, wallet.address)

    expect(await vault.usdfAmounts(bnb.address)).eq(89100)
    expect(await vault.getTargetUsdfAmount(bnb.address)).eq(36366)
    expect(await vault.getTargetUsdfAmount(dai.address)).eq(72733)

    // usdfAmount(bnb) is 88800, targetAmount(bnb) is 36266
    // incrementing bnb has an increased fee, while reducing bnb has a decreased fee
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 10000, 100, 50, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 100, 50, false)).eq(28)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 100, 50, false)).eq(28)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 20000, 100, 50, false)).eq(28)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 50000, 100, 50, false)).eq(28)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 80000, 100, 50, false)).eq(28)

    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 50, 100, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 50, 100, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 10000, 50, 100, true)).eq(150)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 1000, 50, 100, false)).eq(0)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 5000, 50, 100, false)).eq(0)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 20000, 50, 100, false)).eq(0)
    expect(await feeUtilsV2.getFeeBasisPoints(bnb.address, 50000, 50, 100, false)).eq(0)
  })
})
