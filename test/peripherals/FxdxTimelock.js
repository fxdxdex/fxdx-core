const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, increaseTime, mineBlock } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault } = require("../core/Vault/helpers")

use(solidity)

const { AddressZero } = ethers.constants

describe("FxdxTimelock", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, rewardManager, tokenManager, mintReceiver] = provider.getWallets()
  let vault
  let feeUtils
  let feeUtilsV2
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
    vaultUtils = initVaultResult.vaultUtils

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdf.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdf.setYieldTrackers([yieldTracker0.address])

    await vault.setPriceFeed(user3.address)

    timelock = await deployContract("FxdxTimelock", [
      wallet.address,
      5 * 24 * 60 * 60,
      7 * 24 * 60 * 60,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      expandDecimals(1000, 18)
    ])
    await vault.setGov(timelock.address)
    await feeUtils.setGov(timelock.address)

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await vaultPriceFeed.setGov(timelock.address)
    await router.setGov(timelock.address)

    feeUtilsV2 = await deployContract("FeeUtilsV2", [vault.address])
    await feeUtilsV2.initialize(toUsd(5), true)
    await feeUtilsV2.setGov(timelock.address)
  })

  it("inits", async () => {
    expect(await usdf.gov()).eq(wallet.address)
    expect(await usdf.vaults(vault.address)).eq(true)
    expect(await usdf.vaults(user0.address)).eq(false)

    expect(await vault.gov()).eq(timelock.address)
    expect(await vault.isInitialized()).eq(true)
    expect(await vault.router()).eq(router.address)
    expect(await vault.usdf()).eq(usdf.address)
    expect(await feeUtils.liquidationFeeUsd()).eq(toUsd(5))
    expect(await feeUtils.rolloverRateFactor()).eq(600)

    expect(await timelock.admin()).eq(wallet.address)
    expect(await timelock.buffer()).eq(5 * 24 * 60 * 60)
    expect(await timelock.tokenManager()).eq(tokenManager.address)
    expect(await timelock.maxTokenSupply()).eq(expandDecimals(1000, 18))

    await expect(deployContract("FxdxTimelock", [
      wallet.address,
      7 * 24 * 60 * 60 + 1,
      7 * 24 + 60 * 60,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      1000
    ])).to.be.revertedWith("FxdxTimelock: invalid _buffer")

    await expect(deployContract("FxdxTimelock", [
      wallet.address,
      7 * 24 * 60 * 60,
      7 * 24 * 60 * 60 + 1,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      1000
    ])).to.be.revertedWith("FxdxTimelock: invalid _longBuffer")
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
    )).to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).setTokenConfig(
      vault.address,
      bnb.address,
      100,
      200,
      1000,
      0,
      0
    )).to.be.revertedWith("FxdxTimelock: token not yet whitelisted")

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
  })

  it("setBuffer", async () => {
    const timelock0 = await deployContract("FxdxTimelock", [
      user1.address,
      3 * 24 * 60 * 60,
      7 * 24 * 60 * 60,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      1000
    ])
    await expect(timelock0.connect(user0).setBuffer(3 * 24 * 60 * 60 - 10))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock0.connect(user1).setBuffer(7 * 24 * 60 * 60 + 10))
      .to.be.revertedWith("FxdxTimelock: invalid _buffer")

    await expect(timelock0.connect(user1).setBuffer(3 * 24 * 60 * 60 - 10))
      .to.be.revertedWith("FxdxTimelock: buffer cannot be decreased")

    expect(await timelock0.buffer()).eq(3 * 24 * 60 * 60)
    await timelock0.connect(user1).setBuffer(3 * 24 * 60 * 60 + 10)
    expect(await timelock0.buffer()).eq(3 * 24 * 60 * 60 + 10)
  })

  it("setIsAmmEnabled", async () => {
    await expect(timelock.connect(user0).setIsAmmEnabled(vaultPriceFeed.address, false))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vaultPriceFeed.isAmmEnabled()).eq(true)
    await timelock.connect(wallet).setIsAmmEnabled(vaultPriceFeed.address, false)
    expect(await vaultPriceFeed.isAmmEnabled()).eq(false)
  })

  it("setMaxStrictPriceDeviation", async () => {
    await expect(timelock.connect(user0).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(0)
    await timelock.connect(wallet).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100)
    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(100)
  })

  it("setPriceSampleSpace", async () => {
    await expect(timelock.connect(user0).setPriceSampleSpace(vaultPriceFeed.address, 0))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vaultPriceFeed.priceSampleSpace()).eq(3)
    await timelock.connect(wallet).setPriceSampleSpace(vaultPriceFeed.address, 1)
    expect(await vaultPriceFeed.priceSampleSpace()).eq(1)
  })

  it("setVaultUtils", async () => {
    await expect(timelock.connect(user0).setVaultUtils(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vault.vaultUtils()).eq(vaultUtils.address)
    await timelock.connect(wallet).setVaultUtils(vault.address, user1.address)
    expect(await vault.vaultUtils()).eq(user1.address)
  })

  it("setIsSwapEnabled", async () => {
    await expect(timelock.connect(user0).setIsSwapEnabled(vault.address, false))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vault.isSwapEnabled()).eq(true)
    await timelock.connect(wallet).setIsSwapEnabled(vault.address, false)
    expect(await vault.isSwapEnabled()).eq(false)
  })

  it("setContractHandler", async() => {
    await expect(timelock.connect(user0).setContractHandler(user1.address, true))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await timelock.isHandler(user1.address)).eq(false)
    await timelock.connect(wallet).setContractHandler(user1.address, true)
    expect(await timelock.isHandler(user1.address)).eq(true)
  })

  it("setIsLeverageEnabled", async () => {
    await expect(timelock.connect(user0).setIsLeverageEnabled(vault.address, false))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vault.isLeverageEnabled()).eq(true)
    await timelock.connect(wallet).setIsLeverageEnabled(vault.address, false)
    expect(await vault.isLeverageEnabled()).eq(false)

    await expect(timelock.connect(user1).setIsLeverageEnabled(vault.address, false))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).setContractHandler(user1.address, true)

    expect(await vault.isLeverageEnabled()).eq(false)
    await timelock.connect(user1).setIsLeverageEnabled(vault.address, true)
    expect(await vault.isLeverageEnabled()).eq(true)

    await expect(timelock.connect(user1).addExcludedToken(user2.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")
  })

  it("setMaxGlobalShortSize", async () => {
    await expect(timelock.connect(user0).setMaxGlobalShortSize(vault.address, bnb.address, 100))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vault.maxGlobalShortSizes(bnb.address)).eq(0)
    await timelock.connect(wallet).setMaxGlobalShortSize(vault.address, bnb.address, 100)
    expect(await vault.maxGlobalShortSizes(bnb.address)).eq(100)
  })

  it("setMaxGasPrice", async () => {
    await expect(timelock.connect(user0).setMaxGasPrice(vault.address, 7000000000))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vault.maxGasPrice()).eq(0)
    await timelock.connect(wallet).setMaxGasPrice(vault.address, 7000000000)
    expect(await vault.maxGasPrice()).eq(7000000000)
  })

  it("setMaxLeverage", async () => {
    await expect(timelock.connect(user0).setMaxLeverage(vault.address, 100 * 10000))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).setMaxLeverage(vault.address, 49 * 10000))
      .to.be.revertedWith("FxdxTimelock: invalid _maxLeverage")

    expect(await vault.maxLeverage()).eq(50 * 10000)
    await timelock.connect(wallet).setMaxLeverage(vault.address, 100 * 10000)
    expect(await vault.maxLeverage()).eq(100 * 10000)
  })

  it("setRolloverRateV1", async () => {
    await expect(timelock.connect(user0).setRolloverRateV1(feeUtils.address, 59 * 60, 100, 100))
      .to.be.revertedWith("FxdxTimelock: forbidden")

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
  })

  it("setRolloverIntervalV2", async () => {
    await expect(timelock.connect(user0).setRolloverIntervalV2(feeUtilsV2.address, 59 * 60))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).setRolloverIntervalV2(feeUtilsV2.address, 59 * 60))
      .to.be.revertedWith("FeeUtilsV2: invalid _rolloverInterval")

    await timelock.connect(wallet).setRolloverIntervalV2(feeUtilsV2.address, 60 * 60)
    expect(await feeUtilsV2.rolloverInterval()).eq(60 * 60)
  })

  it("transferIn", async () => {
    await bnb.mint(user1.address, 1000)
    await expect(timelock.connect(user0).transferIn(user1.address, bnb.address, 1000))
      .to.be.revertedWith("FxdxTimelock: forbidden")

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
    await expect(timelock.connect(user0).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalApprove(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).approve(bnb.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(101, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

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
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["approve", bnb.address, user1.address, expandDecimals(100, 18)])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["approve", dai.address, user1.address, expandDecimals(100, 18)])

    await expect(timelock.connect(user0).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")
  })

  it("processMint", async () => {
    const fxdx = await deployContract("FXDX", [])
    await fxdx.setGov(timelock.address)

    await expect(timelock.connect(user0).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalMint(fxdx.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).processMint(bnb.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).processMint(fxdx.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(101, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    expect(await fxdx.balanceOf(timelock.address)).eq(0)
    expect(await fxdx.balanceOf(user1.address)).eq(0)

    await timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18))

    expect(await fxdx.balanceOf(timelock.address)).eq(0)
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(100, 18))

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await timelock.connect(wallet).signalMint(fxdx.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["mint", bnb.address, user1.address, expandDecimals(100, 18)])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["mint", fxdx.address, user1.address, expandDecimals(100, 18)])

    await expect(timelock.connect(user0).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).processMint(fxdx.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")
  })

  it("setGov", async () => {
    await expect(timelock.connect(user0).setGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalSetGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).signalSetGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(tokenManager).signalSetGov(vault.address, user1.address)

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setGov(user2.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 2 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    expect(await vault.gov()).eq(timelock.address)
    await timelock.connect(wallet).setGov(vault.address, user1.address)
    expect(await vault.gov()).eq(user1.address)

    await timelock.connect(tokenManager).signalSetGov(vault.address, user2.address)

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setGov", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setGov", vault.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")
  })

  it("setPriceFeed", async () => {
    await expect(timelock.connect(user0).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalSetPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, user1.address)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setPriceFeed(user2.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    expect(await vault.priceFeed()).eq(user3.address)
    await timelock.connect(wallet).setPriceFeed(vault.address, user1.address)
    expect(await vault.priceFeed()).eq(user1.address)

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, user2.address)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setPriceFeed", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setPriceFeed", vault.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")
  })

  it("withdrawToken", async () => {
    const fxdx = await deployContract("FXDX", [])
    await fxdx.setGov(timelock.address)

    await expect(timelock.connect(user0).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalWithdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalWithdrawToken(fxdx.address, bnb.address, user0.address, 100)

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).withdrawToken(dai.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, dai.address, user0.address, 100))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user1.address, 100))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 101))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance")

    await bnb.mint(fxdx.address, 100)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    await timelock.connect(wallet).withdrawToken(fxdx.address, bnb.address, user0.address, 100)
    expect(await bnb.balanceOf(user0.address)).eq(100)
  })

  it("vaultSetTokenConfig", async () => {
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
    )).to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).vaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalVaultSetTokenConfig(
      vault.address,
      dai.address, // _token
      12, // _tokenDecimals
      7000, // _tokenWeight
      120, // _minProfitBps
      5000, // _maxUsdfAmount
      true, // _isStable
      false // isShortable
    )).to.be.revertedWith("FxdxTimelock: forbidden")

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
    )).to.be.revertedWith("FxdxTimelock: action time not yet passed")

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
    )).to.be.revertedWith("FxdxTimelock: action time not yet passed")

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
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

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

  it("priceFeedSetTokenConfig", async () => {
    await timelock.connect(wallet).signalSetPriceFeed(vault.address, vaultPriceFeed.address)
    await increaseTime(provider, 5 * 24 * 60 * 60 + 10)
    await mineBlock(provider)
    await timelock.connect(wallet).setPriceFeed(vault.address, vaultPriceFeed.address)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(70000))

    await expect(timelock.connect(user0).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalPriceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalPriceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action time not yet passed")


    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      user0.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      bnb.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      9, // _priceDecimals
      true // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      false // _isStrictStable
    )).to.be.revertedWith("FxdxTimelock: action not signalled")

    expect(await vaultPriceFeed.priceFeeds(btc.address)).eq(AddressZero)
    expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(0)
    expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(false)
    expect(await vaultPriceFeed.getPriceForReaders(btc.address, true, false)).eq(0)
    await expect(vaultPriceFeed.getPrice(btc.address, true, false, false))
      .to.be.revertedWith("VaultPriceFeed: invalid price")

    await timelock.connect(wallet).priceFeedSetTokenConfig(
      vaultPriceFeed.address,
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      true // _isStrictStable
    )

    expect(await vaultPriceFeed.priceFeeds(btc.address)).eq(btcPriceFeed.address)
    expect(await vaultPriceFeed.priceDecimals(btc.address)).eq(8)
    expect(await vaultPriceFeed.strictStableTokens(btc.address)).eq(true)
    expect(await vaultPriceFeed.getPrice(btc.address, true, false, false)).eq(toNormalizedPrice(70000))
    expect(await vaultPriceFeed.getPriceForReaders(btc.address, true, false)).eq(toNormalizedPrice(70000))
  })

  it("addPlugin", async () => {
    await expect(timelock.connect(user0).addPlugin(router.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).addPlugin(router.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalAddPlugin(router.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalAddPlugin(router.address, user1.address)

    await expect(timelock.connect(wallet).addPlugin(router.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).addPlugin(router.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).addPlugin(user2.address, user1.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(wallet).addPlugin(router.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    expect(await router.plugins(user1.address)).eq(false)
    await timelock.connect(wallet).addPlugin(router.address, user1.address)
    expect(await router.plugins(user1.address)).eq(true)

    await timelock.connect(wallet).signalAddPlugin(router.address, user2.address)

    await expect(timelock.connect(wallet).addPlugin(router.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["addPlugin", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["addPlugin", router.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("FxdxTimelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).addPlugin(router.address, user2.address))
      .to.be.revertedWith("FxdxTimelock: action not signalled")
  })

  it("addExcludedToken", async () => {
    const fxdx = await deployContract("FXDX", [])
    await expect(timelock.connect(user0).addExcludedToken(fxdx.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await timelock.excludedTokens(fxdx.address)).eq(false)
    await timelock.connect(wallet).addExcludedToken(fxdx.address)
    expect(await timelock.excludedTokens(fxdx.address)).eq(true)
  })

  it("setInPrivateTransferMode", async () => {
    const fxdx = await deployContract("FXDX", [])
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(user0.address, 100)
    await expect(timelock.connect(user0).setInPrivateTransferMode(fxdx.address, true))
      .to.be.revertedWith("FxdxTimelock: forbidden")

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

    await timelock.addExcludedToken(fxdx.address)
    await expect(timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, true))
      .to.be.revertedWith("FxdxTimelock: invalid _inPrivateTransferMode")

    await timelock.connect(wallet).setInPrivateTransferMode(fxdx.address, false)
    expect(await fxdx.inPrivateTransferMode()).eq(false)

    await fxdx.connect(user0).transfer(user1.address, 100)
  })

  it("setAdmin", async () => {
    await expect(timelock.setAdmin(user1.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await timelock.admin()).eq(wallet.address)
    await timelock.connect(tokenManager).setAdmin(user1.address)
    expect(await timelock.admin()).eq(user1.address)
  })

  it("setExternalAdmin", async () => {
    const distributor = await deployContract("RewardDistributor", [user1.address, user2.address])
    await distributor.setGov(timelock.address)
    await expect(timelock.connect(user0).setExternalAdmin(distributor.address, user3.address))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await distributor.admin()).eq(wallet.address)
    await timelock.connect(wallet).setExternalAdmin(distributor.address, user3.address)
    expect(await distributor.admin()).eq(user3.address)

    await expect(timelock.connect(wallet).setExternalAdmin(timelock.address, user3.address))
      .to.be.revertedWith("FxdxTimelock: invalid _target")
  })

  it("setInPrivateLiquidationMode", async () => {
    await expect(timelock.connect(user0).setInPrivateLiquidationMode(vault.address, true))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    expect(await vault.inPrivateLiquidationMode()).eq(false)
    await timelock.connect(wallet).setInPrivateLiquidationMode(vault.address, true)
    expect(await vault.inPrivateLiquidationMode()).eq(true)

    await timelock.connect(wallet).setInPrivateLiquidationMode(vault.address, false)
    expect(await vault.inPrivateLiquidationMode()).eq(false)
  })

  it("setLiquidator", async () => {
    await expect(timelock.connect(user0).setLiquidator(vault.address, user1.address, true))
      .to.be.revertedWith("FxdxTimelock: forbidden")

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
    await expect(timelock.connect(user0).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await expect(timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("FxdxTimelock: action not signalled")

    await expect(timelock.connect(user0).signalRedeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("FxdxTimelock: forbidden")

    await timelock.connect(wallet).signalRedeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18))

    await expect(timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("FxdxTimelock: action time not yet passed")

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

    await increaseTime(provider, 7 * 24 * 60 * 60 + 10)
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

    await timelock.connect(tokenManager).signalSetGov(vault.address, user1.address)

    await increaseTime(provider, 7 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await timelock.setGov(vault.address, user1.address)
    await vault.connect(user1).setInManagerMode(true)
    await vault.connect(user1).setGov(timelock.address)

    expect(await bnb.balanceOf(mintReceiver.address)).eq(0)
    await timelock.connect(wallet).redeemUsdf(vault.address, bnb.address, expandDecimals(1000, 18))
    expect(await bnb.balanceOf(mintReceiver.address)).eq("1994000000000000000") // 1.994
  })
})
