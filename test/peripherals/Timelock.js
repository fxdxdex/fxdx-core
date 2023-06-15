const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, increaseTime, mineBlock } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd } = require("../shared/units")
const { initVault } = require("../core/Vault/helpers")
const { keccak256 } = require("ethers/lib/utils")

use(solidity)

const { AddressZero } = ethers.constants

describe("Timelock", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, rewardManager, tokenManager, mintReceiver, positionRouter, swapRouter, liquidityRouter] = provider.getWallets()
  let vault
  let feeUtils
  let feeUtilsV2
  let flpManager
  let flp
  let vaultUtils
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
  let timelock
  let fastPriceEvents
  let fastPriceFeed

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

    flp = await deployContract("FLP", [])
    flpManager = await deployContract("FlpManager", [vault.address, usdf.address, flp.address, 24 * 60 * 60])

    const initVaultResult = await initVault(vault, router, usdf, vaultPriceFeed)
    vaultUtils = initVaultResult.vaultUtils
    feeUtils = initVaultResult.feeUtils

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdf.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdf.setYieldTrackers([yieldTracker0.address])

    await vault.setPriceFeed(user3.address)

    timelock = await deployContract("Timelock", [
      wallet.address, // admin
      5 * 24 * 60 * 60, // buffer
      tokenManager.address, // tokenManager
      mintReceiver.address, // mintReceiver
      flpManager.address, // flpManager
      expandDecimals(1000, 18) // maxTokenSupply
    ])
    await vault.setGov(timelock.address)
    await feeUtils.setGov(timelock.address)

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await vaultPriceFeed.setGov(timelock.address)
    await router.setGov(timelock.address)

    fastPriceEvents = await deployContract("FastPriceEvents", [])
    fastPriceFeed = await deployContract("FastPriceFeed", [
      5 * 60, // _priceDuration
      60 * 60, // _maxPriceUpdateDelay
      2, // _minBlockInterval
      250, // _allowedDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      tokenManager.address, // _tokenManager
      positionRouter.address, // _positionRouter
      swapRouter.address, // _swapRouter
      liquidityRouter.address // _liquidityRouter
    ])

    await fastPriceFeed.setGov(timelock.address)

    feeUtilsV2 = await deployContract("FeeUtilsV2", [ vault.address ])
    await feeUtilsV2.initialize(
      toUsd(5), // liquidationFeeUsd
      true // hasDynamicFees
    )
    feeUtilsV2.setGov(timelock.address)
  })

  it("inits", async () => {
    expect(await usdf.gov()).eq(wallet.address)
    expect(await usdf.vaults(vault.address)).eq(true)
    expect(await usdf.vaults(user0.address)).eq(false)

    expect(await vault.gov()).eq(timelock.address)
    expect(await vault.isInitialized()).eq(true)
    expect(await vault.router()).eq(router.address)
    expect(await vault.usdf()).eq(usdf.address)
    expect(await feeUtils.getLiquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtils.rolloverRateFactor()).eq(600)

    expect(await timelock.admin()).eq(wallet.address)
    expect(await timelock.buffer()).eq(5 * 24 * 60 * 60)
    expect(await timelock.tokenManager()).eq(tokenManager.address)
    expect(await timelock.maxTokenSupply()).eq(expandDecimals(1000, 18))

    await expect(deployContract("Timelock", [
      wallet.address, // admin
      5 * 24 * 60 * 60 + 1, // buffer
      tokenManager.address, // tokenManager
      mintReceiver.address, // mintReceiver
      flpManager.address, // flpManager
      1000 // maxTokenSupply
    ])).to.be.revertedWith("Timelock: invalid _buffer")
  })

  it("setTokenConfig", async () => {
    await timelock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
    await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
    await mineBlock(provider)
    await timelock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

    await bnbPriceFeed.setLatestAnswer(500)

    await expect(timelock.connect(user0).setTokenConfig(
      vault.address,
      bnb.address,
      100,
      200,
      1000,
      0,
      0
    )).to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setTokenConfig(
      vault.address,
      bnb.address,
      100,
      200,
      1000,
      0,
      0
    )).to.be.revertedWith("Timelock: token not yet whitelisted")

    await timelock.connect(wallet).signalVaultSetTokenConfig(
      vault.address,
      bnb.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      5000, // _maxUsdfAmount
      false, // _isStable
      true // isShortable
    )

    await increaseTime(provider, 5 * 24 * 60 *60)
    await mineBlock(provider)

    await timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      bnb.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      5000, // _maxUsdfAmount
      false, // _isStable
      true // isShortable
    )

    expect(await vault.whitelistedTokenCount()).eq(1)
    expect(await vault.totalTokenWeights()).eq(7000)
    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.tokenDecimals(bnb.address)).eq(12)
    expect(await vault.tokenWeights(bnb.address)).eq(7000)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(300)
    expect(await vault.maxUsdfAmounts(bnb.address)).eq(5000)
    expect(await vault.stableTokens(bnb.address)).eq(false)
    expect(await vault.shortableTokens(bnb.address)).eq(true)

    await timelock.connect(wallet).setTokenConfig(
      vault.address,
      bnb.address,
      100, // _tokenWeight
      200, // _minProfitBps
      1000, // _maxUsdfAmount
      300, // _bufferAmount
      500 // _usdfAmount
    )

    expect(await vault.whitelistedTokenCount()).eq(1)
    expect(await vault.totalTokenWeights()).eq(100)
    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.tokenDecimals(bnb.address)).eq(12)
    expect(await vault.tokenWeights(bnb.address)).eq(100)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(200)
    expect(await vault.maxUsdfAmounts(bnb.address)).eq(1000)
    expect(await vault.stableTokens(bnb.address)).eq(false)
    expect(await vault.shortableTokens(bnb.address)).eq(true)
    expect(await vault.bufferAmounts(bnb.address)).eq(300)
    expect(await vault.usdfAmounts(bnb.address)).eq(500)

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setTokenConfig(
      vault.address,
      bnb.address,
      100, // _tokenWeight
      50, // _minProfitBps
      1000, // _maxUsdfAmount
      300, // _bufferAmount
      500 // _usdfAmount
    )

    expect(await vault.minProfitBasisPoints(bnb.address)).eq(50)
  })

  it("setUsdfAmounts", async () => {
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.usdfAmounts(dai.address)).eq(0)

    await expect(timelock.connect(user0).setUsdfAmounts(vault.address, [bnb.address, dai.address], [500, 250]))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).setUsdfAmounts(vault.address, [bnb.address, dai.address], [500, 250])

    expect(await vault.usdfAmounts(bnb.address)).eq(500)
    expect(await vault.usdfAmounts(dai.address)).eq(250)
  })

  it("updateUsdfSupply", async () => {
    await usdf.addVault(wallet.address)
    await usdf.mint(flpManager.address, 1000)

    expect(await usdf.balanceOf(flpManager.address)).eq(1000)
    expect(await usdf.totalSupply()).eq(1000)

    await expect(timelock.connect(user0).updateUsdfSupply(500))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.updateUsdfSupply(500))
      .to.be.revertedWith("YieldToken: forbidden")

    await usdf.setGov(timelock.address)

    await timelock.updateUsdfSupply(500)

    expect(await usdf.balanceOf(flpManager.address)).eq(500)
    expect(await usdf.totalSupply()).eq(500)

    await timelock.updateUsdfSupply(2000)

    expect(await usdf.balanceOf(flpManager.address)).eq(2000)
    expect(await usdf.totalSupply()).eq(2000)
  })

  it("setBuffer", async () => {
    const timelock0 = await deployContract("Timelock", [
      user1.address,
      3 * 24 * 60 * 60,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      1000
    ])
    await expect(timelock0.connect(user0).setBuffer(3 * 24 * 60 * 60 - 10))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock0.connect(user1).setBuffer(5 * 24 * 60 * 60 + 10))
      .to.be.revertedWith("Timelock: invalid _buffer")

    await expect(timelock0.connect(user1).setBuffer(3 * 24 * 60 * 60 - 10))
      .to.be.revertedWith("Timelock: buffer cannot be decreased")

    expect(await timelock0.buffer()).eq(3 * 24 * 60 * 60)
    await timelock0.connect(user1).setBuffer(3 * 24 * 60 * 60 + 10)
    expect(await timelock0.buffer()).eq(3 * 24 * 60 * 60 + 10)
  })

  it ("setTier", async () => {
    const referralStorage = await deployContract("ReferralStorage", [])
    await referralStorage.setGov(timelock.address)

    await expect(timelock.connect(user0).setTier(referralStorage.address, 0, 1000, 5000))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setKeeper(user0.address, true)

    let tier0 = await referralStorage.tiers(0)
    expect(tier0.totalRebate).eq(0)
    expect(tier0.discountShare).eq(0)

    await timelock.connect(user0).setTier(referralStorage.address, 0, 1000, 5000)
    tier0 = await referralStorage.tiers(0)
    expect(tier0.totalRebate).eq(1000)
    expect(tier0.discountShare).eq(5000)
  })

  it ("setReferrerTier", async () => {
    const referralStorage = await deployContract("ReferralStorage", [])
    await referralStorage.setGov(timelock.address)

    await expect(timelock.connect(user0).setReferrerTier(referralStorage.address, user1.address, 1))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setKeeper(user0.address, true)

    expect(await referralStorage.referrerTiers(user1.address)).equal(0)
    await timelock.connect(user0).setReferrerTier(referralStorage.address, user1.address, 1)
    expect(await referralStorage.referrerTiers(user1.address)).equal(1)
  })

  it ("govSetCodeOwner", async () => {
    const referralStorage = await deployContract("ReferralStorage", [])
    await referralStorage.setGov(timelock.address)

    const code = keccak256("0xFF")

    await referralStorage.connect(user1).registerCode(code)
    expect (await referralStorage.codeOwners(code)).to.be.equal(user1.address)

    await expect(timelock.connect(user0).govSetCodeOwner(referralStorage.address, code, user2.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setKeeper(user0.address, true)

    await timelock.connect(user0).govSetCodeOwner(referralStorage.address, code, user2.address)

    expect (await referralStorage.codeOwners(code)).to.be.equal(user2.address)
  })

  it ("setLiquidityReferralTierTotalRebate", async () => {
    const liquidityReferralStorage = await deployContract("LiquidityReferralStorage", [])
    await liquidityReferralStorage.setGov(timelock.address)

    await expect(timelock.connect(user0).setLiquidityReferralTierTotalRebate(liquidityReferralStorage.address, 0, 1000))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setKeeper(user0.address, true)

    expect(await liquidityReferralStorage.tierTotalRebates(0)).eq(0)

    await timelock.connect(user0).setLiquidityReferralTierTotalRebate(liquidityReferralStorage.address, 0, 1000)
    expect(await liquidityReferralStorage.tierTotalRebates(0)).eq(1000)
  })

  it ("setLiquidityReferrerTier", async () => {
    const liquidityReferralStorage = await deployContract("LiquidityReferralStorage", [])
    await liquidityReferralStorage.setGov(timelock.address)

    await expect(timelock.connect(user0).setReferrerTier(liquidityReferralStorage.address, user1.address, 1))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setKeeper(user0.address, true)

    expect(await liquidityReferralStorage.referrerTiers(user1.address)).equal(0)
    await timelock.connect(user0).setLiquidityReferrerTier(liquidityReferralStorage.address, user1.address, 1)
    expect(await liquidityReferralStorage.referrerTiers(user1.address)).equal(1)
  })

  it("setVaultUtils", async () => {
    await expect(timelock.connect(user0).setVaultUtils(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.vaultUtils()).eq(vaultUtils.address)
    await timelock.connect(wallet).setVaultUtils(vault.address, user1.address)
    expect(await vault.vaultUtils()).eq(user1.address)
  })

  it("setFeeUtils", async () => {
    await expect(timelock.connect(user0).setFeeUtils(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.feeUtils()).eq(feeUtils.address)
    await timelock.connect(wallet).setFeeUtils(vault.address, user1.address)
    expect(await vault.feeUtils()).eq(user1.address)
  })

  it("setIsSwapEnabled", async () => {
    await expect(timelock.connect(user0).setIsSwapEnabled(vault.address, false))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.isSwapEnabled()).eq(true)
    await timelock.connect(wallet).setIsSwapEnabled(vault.address, false)
    expect(await vault.isSwapEnabled()).eq(false)
  })

  it("setContractHandler", async() => {
    await expect(timelock.connect(user0).setContractHandler(user1.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await timelock.isHandler(user1.address)).eq(false)
    await timelock.connect(wallet).setContractHandler(user1.address, true)
    expect(await timelock.isHandler(user1.address)).eq(true)
  })

  it("setKeeper", async() => {
    await expect(timelock.connect(user0).setKeeper(user1.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await timelock.isKeeper(user1.address)).eq(false)
    await timelock.connect(wallet).setKeeper(user1.address, true)
    expect(await timelock.isKeeper(user1.address)).eq(true)
  })

  it("setIsLeverageEnabled", async () => {
    await expect(timelock.connect(user0).setIsLeverageEnabled(vault.address, false))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.isLeverageEnabled()).eq(true)
    await timelock.connect(wallet).setIsLeverageEnabled(vault.address, false)
    expect(await vault.isLeverageEnabled()).eq(false)

    await timelock.connect(wallet).setIsLeverageEnabled(vault.address, true)
    expect(await vault.isLeverageEnabled()).eq(true)
  })

  it("setMaxGlobalShortSize", async () => {
    await expect(timelock.connect(user0).setMaxGlobalShortSize(vault.address, bnb.address, 100))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.maxGlobalShortSizes(bnb.address)).eq(0)
    await timelock.connect(wallet).setMaxGlobalShortSize(vault.address, bnb.address, 100)
    expect(await vault.maxGlobalShortSizes(bnb.address)).eq(100)
  })

  it("setMaxGasPrice", async () => {
    await expect(timelock.connect(user0).setMaxGasPrice(vault.address, 7000000000))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.maxGasPrice()).eq(0)
    await timelock.connect(wallet).setMaxGasPrice(vault.address, 7000000000)
    expect(await vault.maxGasPrice()).eq(7000000000)
  })

  it("setMaxLeverage", async () => {
    await expect(timelock.connect(user0).setMaxLeverage(vault.address, 100 * 10000))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setMaxLeverage(vault.address, 49 * 10000))
      .to.be.revertedWith("Timelock: invalid _maxLeverage")

    expect(await vault.maxLeverage()).eq(50 * 10000)
    await timelock.connect(wallet).setMaxLeverage(vault.address, 100 * 10000)
    expect(await vault.maxLeverage()).eq(100 * 10000)
  })

  it("setRolloverRateV1", async () => {
    await expect(timelock.connect(user0).setRolloverRateV1(feeUtils.address, 59 * 60, 100, 100))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setRolloverRateV1(feeUtils.address, 59 * 60, 100, 100))
      .to.be.revertedWith("FeeUtilsV1: invalid _rolloverInterval")

    expect(await feeUtils.rolloverRateFactor()).eq(600)
    expect(await feeUtils.stableRolloverRateFactor()).eq(600)
    await timelock.connect(wallet).setRolloverRateV1(feeUtils.address, 60 * 60, 0, 100)
    expect(await feeUtils.rolloverRateFactor()).eq(0)
    expect(await feeUtils.stableRolloverRateFactor()).eq(100)

    await timelock.connect(wallet).setRolloverRateV1(feeUtils.address, 60 * 60, 100, 0)
    expect(await feeUtils.rolloverInterval()).eq(60 * 60)
    expect(await feeUtils.rolloverRateFactor()).eq(100)
    expect(await feeUtils.stableRolloverRateFactor()).eq(0)

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setRolloverRateV1(feeUtils.address, 120 * 60, 50, 75)
    expect(await feeUtils.rolloverInterval()).eq(120 * 60)
    expect(await feeUtils.rolloverRateFactor()).eq(50)
    expect(await feeUtils.stableRolloverRateFactor()).eq(75)
  })

  it("setRolloverIntervalV2", async () => {
    await expect(timelock.connect(user0).setRolloverIntervalV2(feeUtilsV2.address, 59 * 60))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setRolloverIntervalV2(feeUtilsV2.address, 59 * 60))
      .to.be.revertedWith("FeeUtilsV2: invalid _rolloverInterval")

    await timelock.connect(wallet).setRolloverIntervalV2(feeUtilsV2.address, 60 * 60)
    expect(await feeUtilsV2.rolloverInterval()).eq(60 * 60)

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setRolloverIntervalV2(feeUtilsV2.address, 120 * 60)
    expect(await feeUtilsV2.rolloverInterval()).eq(120 * 60)
  })

  it("transferIn", async () => {
    await bnb.mint(user1.address, 1000)
    await expect(timelock.connect(user0).transferIn(user1.address, bnb.address, 1000))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).transferIn(user1.address, bnb.address, 1000))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await bnb.connect(user1).approve(timelock.address, 1000)

    expect(await bnb.balanceOf(user1.address)).eq(1000)
    expect(await bnb.balanceOf(timelock.address)).eq(0)
    await timelock.connect(wallet).transferIn(user1.address, bnb.address, 1000)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(timelock.address)).eq(1000)
  })

  it("approve", async () => {
    await timelock.setContractHandler(user0.address, true)
    await expect(timelock.connect(user0).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalApprove(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action already signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).approve(bnb.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(101, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await dai.mint(timelock.address, expandDecimals(150, 18))

    expect(await dai.balanceOf(timelock.address)).eq(expandDecimals(150, 18))
    expect(await dai.balanceOf(user1.address)).eq(0)

    await expect(dai.connect(user1).transferFrom(timelock.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))
    await expect(dai.connect(user2).transferFrom(timelock.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")
    await dai.connect(user1).transferFrom(timelock.address, user1.address, expandDecimals(100, 18))

    expect(await dai.balanceOf(timelock.address)).eq(expandDecimals(50, 18))
    expect(await dai.balanceOf(user1.address)).eq(expandDecimals(100, 18))

    await expect(dai.connect(user1).transferFrom(timelock.address, user1.address, expandDecimals(1, 18)))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["approve", bnb.address, user1.address, expandDecimals(100, 18)])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["approve", dai.address, user1.address, expandDecimals(100, 18)])

    await expect(timelock.connect(user0).cancelAction(action0))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("processMint", async () => {
    await timelock.setContractHandler(user0.address, true)
    const fxdx = await deployContract("FXDX", [])
    await fxdx.setGov(timelock.address)

    await expect(timelock.connect(user0).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalMint(fxdx.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).processMint(bnb.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).processMint(fxdx.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(101, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await fxdx.balanceOf(timelock.address)).eq(0)
    expect(await fxdx.balanceOf(user1.address)).eq(0)

    await timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18))

    expect(await fxdx.balanceOf(timelock.address)).eq(0)
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(100, 18))

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await timelock.connect(wallet).signalMint(fxdx.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["mint", bnb.address, user1.address, expandDecimals(100, 18)])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["mint", fxdx.address, user1.address, expandDecimals(100, 18)])

    await expect(timelock.connect(user0).cancelAction(action0))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("setHandler", async () => {
    await timelock.setContractHandler(user0.address, true)
    const vester = await deployContract("Vester", [
      "Vested FXDX",
      "veFXDX",
      365 * 24 * 60 * 60,
      AddressZero,
      AddressZero,
      AddressZero,
      AddressZero
    ])
    await vester.setGov(timelock.address)

    await expect(timelock.connect(user0).setHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalSetHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalSetHandler(vester.address, user1.address, true)

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setHandler(bnb.address, user1.address, true))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).setHandler(vester.address, user2.address, true))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, false))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await vester.isHandler(user1.address)).eq(false)
    await timelock.connect(wallet).setHandler(vester.address, user1.address, true)
    expect(await vester.isHandler(user1.address)).eq(true)

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: action not signalled")

    await timelock.connect(wallet).signalSetHandler(vester.address, user1.address, true)

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address", "bool"], ["setHandler", bnb.address, user1.address, true])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address", "bool"], ["setHandler", vester.address, user1.address, true])

    await expect(timelock.connect(user0).cancelAction(action0))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setHandler(vester.address, user1.address, true))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("setGov", async () => {
    await timelock.setContractHandler(user0.address, true)

    await expect(timelock.connect(user0).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalSetGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalSetGov(vault.address, user1.address)

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setGov(user2.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await vault.gov()).eq(timelock.address)
    await timelock.connect(wallet).setGov(vault.address, user1.address)
    expect(await vault.gov()).eq(user1.address)

    await timelock.connect(wallet).signalSetGov(vault.address, user2.address)

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setGov", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setGov", vault.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("setPriceFeed", async () => {
    await timelock.setContractHandler(user0.address, true)

    await expect(timelock.connect(user0).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalSetPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, user1.address)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setPriceFeed(user2.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await vault.priceFeed()).eq(user3.address)
    await timelock.connect(wallet).setPriceFeed(vault.address, user1.address)
    expect(await vault.priceFeed()).eq(user1.address)

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, user2.address)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setPriceFeed", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setPriceFeed", vault.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("withdrawToken", async () => {
    await timelock.setContractHandler(user0.address, true)

    const fxdx = await deployContract("FXDX", [])
    await fxdx.setGov(timelock.address)

    await expect(timelock.connect(user0).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalWithdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalWithdrawToken(fxdx.address, bnb.address, user0.address, 100)

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).withdrawToken(dai.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, dai.address, user0.address, 100))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user1.address, 100))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 101))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance")

    await bnb.mint(fxdx.address, 100)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    await timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100)
    expect(await bnb.balanceOf(user0.address)).eq(100)
  })

  it("vaultSetTokenConfig", async () => {
    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
    await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
    await mineBlock(provider)
    await timelock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

    await daiPriceFeed.setLatestAnswer(1)

    await expect(timelock.connect(user0).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalVaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalVaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )

    await expect(timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      15, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("Timelock: action not signalled")

    expect(await vault.totalTokenWeights()).eq(0)
    expect(await vault.whitelistedTokens(dai.address)).eq(false)
    expect(await vault.tokenDecimals(dai.address)).eq(0)
    expect(await vault.tokenWeights(dai.address)).eq(0)
    expect(await vault.minProfitBasisPoints(dai.address)).eq(0)
    expect(await vault.maxUsdfAmounts(dai.address)).eq(0)
    expect(await vault.stableTokens(dai.address)).eq(false)
    expect(await vault.shortableTokens(dai.address)).eq(false)

    await timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )

    expect(await vault.totalTokenWeights()).eq(7000)
    expect(await vault.whitelistedTokens(dai.address)).eq(true)
    expect(await vault.tokenDecimals(dai.address)).eq(12)
    expect(await vault.tokenWeights(dai.address)).eq(7000)
    expect(await vault.minProfitBasisPoints(dai.address)).eq(120)
    expect(await vault.maxUsdfAmounts(dai.address)).eq(5000)
    expect(await vault.stableTokens(dai.address)).eq(true)
    expect(await vault.shortableTokens(dai.address)).eq(false)
  })

  it("vaultClearTokenConfig", async () => {
    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
    await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
    await mineBlock(provider)
    await timelock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

    await daiPriceFeed.setLatestAnswer(1)

    await expect(timelock.connect(user0).vaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )).to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).vaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )).to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalVaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )).to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalVaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )

    await expect(timelock.connect(wallet).vaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )).to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).vaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )).to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).vaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )).to.be.revertedWith("Vault: token not whitelisted")

    await timelock.connect(wallet).signalVaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )

    await increaseTime(provider, 5 * 24 * 60 *60)
    await mineBlock(provider)

    await timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )

    expect(await vault.totalTokenWeights()).eq(7000)
    expect(await vault.whitelistedTokens(dai.address)).eq(true)
    expect(await vault.tokenDecimals(dai.address)).eq(12)
    expect(await vault.tokenWeights(dai.address)).eq(7000)
    expect(await vault.minProfitBasisPoints(dai.address)).eq(120)
    expect(await vault.maxUsdfAmounts(dai.address)).eq(5000)
    expect(await vault.stableTokens(dai.address)).eq(true)
    expect(await vault.shortableTokens(dai.address)).eq(false)

    await timelock.connect(wallet).vaultClearTokenConfig(
      vault.address,
      dai.address // _token
    )

    expect(await vault.totalTokenWeights()).eq(0)
    expect(await vault.whitelistedTokens(dai.address)).eq(false)
    expect(await vault.tokenDecimals(dai.address)).eq(0)
    expect(await vault.tokenWeights(dai.address)).eq(0)
    expect(await vault.minProfitBasisPoints(dai.address)).eq(0)
    expect(await vault.maxUsdfAmounts(dai.address)).eq(0)
    expect(await vault.stableTokens(dai.address)).eq(false)
    expect(await vault.shortableTokens(dai.address)).eq(false)
  })

  it("setInPrivateTransferMode", async () => {
    const fxdx = await deployContract("FXDX", [])
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(user0.address, 100)
    await expect(timelock.connect(user0).setInPrivateTransferMode(fxdx.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, true))
      .to.be.revertedWith("BaseToken: forbidden")

    await fxdx.setGov(timelock.address)

    expect(await fxdx.inPrivateTransferMode()).eq(false)
    await timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, true)
    expect(await fxdx.inPrivateTransferMode()).eq(true)

    await timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, false)
    expect(await fxdx.inPrivateTransferMode()).eq(false)

    await timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, true)
    expect(await fxdx.inPrivateTransferMode()).eq(true)

    await expect(fxdx.connect(user0).transfer(user1.address, 100))
      .to.be.revertedWith("BaseToken: msg.sender not whitelisted")

    await timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, false)
    expect(await fxdx.inPrivateTransferMode()).eq(false)

    await fxdx.connect(user0).transfer(user1.address, 100)
  })

  it("batchSetBonusRewards", async () => {
    const vester = await deployContract("Vester", [
      "Vested FXDX",
      "veFXDX",
      365 * 24 * 60 * 60,
      AddressZero,
      AddressZero,
      AddressZero,
      AddressZero
    ])
    await vester.setGov(timelock.address)

    const accounts = [user1.address, user2.address, user3.address]
    const amounts = [700, 500, 900]

    await expect(timelock.connect(user0).batchSetBonusRewards(vester.address, accounts, amounts))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vester.bonusRewards(user1.address)).eq(0)
    expect(await vester.bonusRewards(user2.address)).eq(0)
    expect(await vester.bonusRewards(user3.address)).eq(0)
    await timelock.connect(wallet).batchSetBonusRewards(vester.address, accounts, amounts)
    expect(await vester.bonusRewards(user1.address)).eq(700)
    expect(await vester.bonusRewards(user2.address)).eq(500)
    expect(await vester.bonusRewards(user3.address)).eq(900)
  })

  it("setAdmin", async () => {
    await expect(timelock.setAdmin(user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await timelock.admin()).eq(wallet.address)
    await timelock.connect(tokenManager).setAdmin(user1.address)
    expect(await timelock.admin()).eq(user1.address)
  })

  it("setExternalAdmin", async () => {
    const distributor = await deployContract("RewardDistributor", [user1.address, user2.address])
    await distributor.setGov(timelock.address)
    await expect(timelock.connect(user0).setExternalAdmin(distributor.address, user3.address))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await distributor.admin()).eq(wallet.address)
    await timelock.connect(wallet).setExternalAdmin(distributor.address, user3.address)
    expect(await distributor.admin()).eq(user3.address)

    await expect(timelock.connect(wallet).setExternalAdmin(timelock.address, user3.address))
      .to.be.revertedWith("Timelock: invalid _target")
  })

  it("setShouldToggleIsLeverageEnabled", async () => {
    await expect(timelock.connect(user0).setShouldToggleIsLeverageEnabled(true))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.false
    await expect(timelock.setShouldToggleIsLeverageEnabled(true))
    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.true
    await expect(timelock.setShouldToggleIsLeverageEnabled(false))
    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.false

    await timelock.setContractHandler(user0.address, true)
    await timelock.connect(user0).setShouldToggleIsLeverageEnabled(true)
    expect(await timelock.shouldToggleIsLeverageEnabled()).to.be.true
  })

  it("setFeeMultiplierIfInactive", async () => {
    await expect(timelock.connect(user0).setFeeMultiplierIfInactive(feeUtils.address, 100))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await feeUtils.feeMultiplierIfInactive()).eq(1)

    await timelock.setFeeMultiplierIfInactive(feeUtils.address, 100)
    expect(await feeUtils.feeMultiplierIfInactive()).eq(100)

    await timelock.setContractHandler(user0.address, true)
    await timelock.connect(user0).setFeeMultiplierIfInactive(feeUtils.address, 20)
    expect(await feeUtils.feeMultiplierIfInactive()).eq(20)
  })

  it("setMinProfitTime", async () => {
    await expect(timelock.connect(user0).setMinProfitTime(vault.address, 8))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.minProfitTime()).eq(0)

    await timelock.setMinProfitTime(vault.address, 8)
    expect(await vault.minProfitTime()).eq(8)

    await timelock.setContractHandler(user0.address, true)
    await timelock.connect(user0).setMinProfitTime(vault.address, 18)
    expect(await vault.minProfitTime()).eq(18)
  })

  it("setFeesV1", async () => {
    await expect(timelock.connect(user0).setFeesV1(
      feeUtils.address,
      1, // _taxBasisPoints,
      2, // _stableTaxBasisPoints,
      3, // _mintBurnFeeBasisPoints,
      4, // _swapFeeBasisPoints,
      5, // _stableSwapFeeBasisPoints,
      6, // _marginFeeBasisPoints,
      7, // _liquidationFeeUsd,
      false
    )).to.be.revertedWith("Timelock: forbidden")

    expect(await feeUtils.taxBasisPoints()).eq(50)
    expect(await feeUtils.stableTaxBasisPoints()).eq(20)
    expect(await feeUtils.mintBurnFeeBasisPoints()).eq(30)
    expect(await feeUtils.swapFeeBasisPoints()).eq(30)
    expect(await feeUtils.stableSwapFeeBasisPoints()).eq(4)
    expect(await feeUtils.marginFeeBasisPoints()).eq(10)
    expect(await feeUtils.liquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtils.hasDynamicFees()).eq(false)

    await timelock.connect(wallet).setFeesV1(
      feeUtils.address,
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

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setFeesV1(
      feeUtils.address,
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

  it("setLiquidationFeeUsdV2", async () => {
    await expect(timelock.connect(user0).setLiquidationFeeUsdV2(feeUtilsV2.address, 60))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setLiquidationFeeUsdV2(feeUtilsV2.address, expandDecimals(101, 30)))
      .to.be.revertedWith("FeeUtilsV2: invalid _liquidationFeeUsd")

    await timelock.connect(wallet).setLiquidationFeeUsdV2(feeUtilsV2.address, 60)
    expect(await feeUtilsV2.liquidationFeeUsd()).eq(60)

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setLiquidationFeeUsdV2(feeUtilsV2.address, 120)
    expect(await feeUtilsV2.liquidationFeeUsd()).eq(120)
  })

  it("setHasDynamicFeesV2", async () => {
    await expect(timelock.connect(user0).setHasDynamicFeesV2(feeUtilsV2.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).setHasDynamicFeesV2(feeUtilsV2.address, true)
    expect(await feeUtilsV2.hasDynamicFees()).eq(true)

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setHasDynamicFeesV2(feeUtilsV2.address, false)
    expect(await feeUtilsV2.hasDynamicFees()).eq(false)
  })

  it("setTokenFeeFactorsV2", async () => {
    await expect(timelock.connect(user0).setTokenFeeFactorsV2(
      feeUtilsV2.address,
      bnb.address,
      1, // _taxBasisPoints,
      2, // _mintBurnFeeBasisPoints,
      3, // _swapFeeBasisPoints,
      4, // _rolloverRateFactor,
      [5], // _relativePnlList
      [6], // _positionFeeBpsList
      [7] // profitFeeBpsList
    )).to.be.revertedWith("Timelock: forbidden")

    expect(await feeUtilsV2.taxBasisPoints(bnb.address)).eq(0)
    expect(await feeUtilsV2.mintBurnFeeBasisPoints(bnb.address)).eq(0)
    expect(await feeUtilsV2.swapFeeBasisPoints(bnb.address)).eq(0)
    expect(await feeUtilsV2.rolloverRateFactors(bnb.address)).eq(0)

    await timelock.connect(wallet).setTokenFeeFactorsV2(
      feeUtilsV2.address,
      bnb.address,
      1, // _taxBasisPoints,
      2, // _mintBurnFeeBasisPoints,
      3, // _swapFeeBasisPoints,
      4, // _rolloverRateFactor,
      [5], // _relativePnlList
      [6], // _positionFeeBpsList
      [7] // profitFeeBpsList
    )

    expect(await feeUtilsV2.taxBasisPoints(bnb.address)).eq(1)
    expect(await feeUtilsV2.mintBurnFeeBasisPoints(bnb.address)).eq(2)
    expect(await feeUtilsV2.swapFeeBasisPoints(bnb.address)).eq(3)
    expect(await feeUtilsV2.rolloverRateFactors(bnb.address)).eq(4)
    expect(await feeUtilsV2.relativePnlLists(bnb.address, 0)).eq(5)
    expect(await feeUtilsV2.positionFeeBasisPointsLists(bnb.address, 0)).eq(6)
    expect(await feeUtilsV2.profitFeeBasisPointsLists(bnb.address, 0)).eq(7)

    await timelock.setContractHandler(user0.address, true)

    await timelock.connect(user0).setTokenFeeFactorsV2(
      feeUtilsV2.address,
      bnb.address,
      8, // _taxBasisPoints,
      9, // _mintBurnFeeBasisPoints,
      10, // _swapFeeBasisPoints,
      11, // _rolloverRateFactor,
      [12, 13], // _relativePnlList
      [14, 15], // _positionFeeBpsList
      [16, 17] // profitFeeBpsList
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

  it("toggle leverage", async () => {
    await expect(timelock.connect(user0).enableLeverage(vault.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.setShouldToggleIsLeverageEnabled(true)
    const initialTaxBasisPoints = await feeUtils.taxBasisPoints()

    expect(await vault.isLeverageEnabled()).to.be.true

    await timelock.disableLeverage(vault.address)
    expect (await feeUtils.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
    expect(await feeUtils.isActive()).to.be.false
    expect(await vault.isLeverageEnabled()).to.be.false

    await timelock.enableLeverage(vault.address)
    expect (await feeUtils.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
    expect(await feeUtils.isActive()).to.be.true
    expect(await vault.isLeverageEnabled()).to.be.true

    timelock.setShouldToggleIsLeverageEnabled(false)
    await timelock.disableLeverage(vault.address)
    expect (await feeUtils.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
    expect(await feeUtils.isActive()).to.be.false
    expect(await vault.isLeverageEnabled()).to.be.true

    timelock.setShouldToggleIsLeverageEnabled(true)
    await timelock.disableLeverage(vault.address)
    timelock.setShouldToggleIsLeverageEnabled(false)
    await timelock.enableLeverage(vault.address)
    expect(await feeUtils.taxBasisPoints()).to.be.equal(initialTaxBasisPoints)
    expect(await feeUtils.isActive()).to.be.true
    expect(await vault.isLeverageEnabled()).to.be.false
  })

  it("toggle feeUtils isActive", async () => {
    await expect(timelock.connect(user0).activateFeeUtils(vault.address))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await feeUtils.isActive()).to.be.false

    await timelock.activateFeeUtils(vault.address)
    expect(await feeUtils.isActive()).to.be.true

    await timelock.deactivateFeeUtils(vault.address)
    expect(await feeUtils.isActive()).to.be.false
  })

  it("setInPrivateLiquidationMode", async () => {
    await expect(timelock.connect(user0).setInPrivateLiquidationMode(vault.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.inPrivateLiquidationMode()).eq(false)
    await timelock.connect(wallet).setInPrivateLiquidationMode(vault.address, true)
    expect(await vault.inPrivateLiquidationMode()).eq(true)

    await timelock.connect(wallet).setInPrivateLiquidationMode(vault.address, false)
    expect(await vault.inPrivateLiquidationMode()).eq(false)
  })

  it("setLiquidator", async () => {
    await expect(timelock.connect(user0).setLiquidator(vault.address, user1.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.isLiquidator(user1.address)).eq(false)
    await timelock.connect(wallet).setLiquidator(vault.address, user1.address, true)
    expect(await vault.isLiquidator(user1.address)).eq(true)

    await timelock.connect(wallet).setLiquidator(vault.address, user1.address, false)
    expect(await vault.isLiquidator(user1.address)).eq(false)

    await expect(vault.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user2.address))
      .to.be.revertedWith("Vault: empty position")

    await timelock.connect(wallet).setInPrivateLiquidationMode(vault.address, true)

    await expect(vault.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user2.address))
      .to.be.revertedWith("Vault: invalid liquidator")

    await timelock.connect(wallet).setLiquidator(vault.address, user1.address, true)

    await expect(vault.connect(user1).liquidatePosition(user0.address, bnb.address, bnb.address, true, user2.address))
      .to.be.revertedWith("Vault: empty position")
  })

  it("redeemUsdf", async () => {
    await timelock.setContractHandler(user0.address, true)

    await expect(timelock.connect(user0).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalRedeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalRedeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18))

    await expect(timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 5 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("YieldToken: forbidden")

    await usdf.setGov(timelock.address)

    await expect(timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
    await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
    await mineBlock(provider)
    await timelock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))

    await timelock.connect(wallet).signalVaultSetTokenConfig(
      vault.address,
      bnb.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      expandDecimals(5000, 18), // _maxUsdfAmount
      false, // _isStable
      true // isShortable
    )

    await increaseTime(provider, 5 * 24 * 60 *60)
    await mineBlock(provider)

    await timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      bnb.address, // _token
      18, // _tokenDecimals
      7000, // _tokenWeight
      300, // _minProfitBps
      expandDecimals(5000, 18), // _maxUsdfAmount
      false, // _isStable
      true // isShortable
    )

    await bnb.mint(vault.address, expandDecimals(3, 18))
    await vault.buyUSDF(bnb.address, user3.address)

    await timelock.signalSetGov(vault.address, user1.address)

    await increaseTime(provider, 5 * 24 * 60 *60)
    await mineBlock(provider)

    await timelock.setGov(vault.address, user1.address)
    await vault.connect(user1).setInManagerMode(true)
    await vault.connect(user1).setGov(timelock.address)

    expect(await bnb.balanceOf(mintReceiver.address)).eq(0)
    await timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18))
    expect(await bnb.balanceOf(mintReceiver.address)).eq("1994000000000000000") // 1.994
  })
})
