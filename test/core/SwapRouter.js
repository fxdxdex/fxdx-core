const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet, bigNumberify } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("SwapRouter", function () {
  const { AddressZero, HashZero } = ethers.constants
  const provider = waffle.provider
  const [wallet, positionKeeper, minter, user0, user1, user2, user3, user4, user5, tokenManager, mintReceiver, signer0, signer1, updater0, updater1] = provider.getWallets()
  const depositFee = 50
  const minExecutionFee = 4000

  let vault
  let timelock
  let usdf
  let router
  let positionRouter
  let swapRouter
  let liquidityRouter
  let referralStorage
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed
  let busd
  let busdPriceFeed
  let distributor0
  let yieldTracker0
  let reader
  let fastPriceFeed
  let fastPriceEvents

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])
    await bnb.connect(minter).deposit({ value: expandDecimals(100, 18) })

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    timelock = await deployContract("Timelock", [
      wallet.address,
      5 * 24 * 60 * 60,
      AddressZero,
      tokenManager.address,
      mintReceiver.address,
      expandDecimals(1000, 18)
    ])

    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    positionRouter = await deployContract("PositionRouter", [vault.address, router.address, bnb.address, depositFee, minExecutionFee])
    referralStorage = await deployContract("ReferralStorage", [])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    await positionRouter.setReferralStorage(referralStorage.address)
    await referralStorage.setHandler(positionRouter.address, true)

    const { feeUtils } = await initVault(vault, router, usdf, vaultPriceFeed)

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdf.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdf.setYieldTrackers([yieldTracker0.address])

    reader = await deployContract("Reader", [])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await vault.setIsLeverageEnabled(false)
    await vault.setGov(timelock.address)
    await feeUtils.setGov(timelock.address)

    const rewardRouter = await deployContract("RewardRouterV2", [])
    swapRouter = await deployContract("SwapRouter", [vault.address, router.address, bnb.address, minExecutionFee])
    liquidityRouter = await deployContract("LiquidityRouter", [vault.address, router.address, rewardRouter.address, bnb.address, minExecutionFee])

    fastPriceEvents = await deployContract("FastPriceEvents", [])
    fastPriceFeed = await deployContract("FastPriceFeed", [
      5 * 60, // _priceDuration
      120 * 60, // _maxPriceUpdateDelay
      2, // _minBlockInterval
      250, // _maxDeviationBasisPoints
      fastPriceEvents.address, // _fastPriceEvents
      tokenManager.address, // _tokenManager
      positionRouter.address, // _positionRouter
      swapRouter.address,
      liquidityRouter.address
    ])
    await fastPriceFeed.initialize(2, [signer0.address, signer1.address], [updater0.address, updater1.address])
    await fastPriceEvents.setIsPriceFeed(fastPriceFeed.address, true)

    await fastPriceFeed.setVaultPriceFeed(vaultPriceFeed.address)
    await vaultPriceFeed.setSecondaryPriceFeed(fastPriceFeed.address)

    await timelock.setContractHandler(swapRouter.address, true)
  })

  it("inits", async () => {
    expect(await swapRouter.vault()).eq(vault.address)
    expect(await swapRouter.router()).eq(router.address)
    expect(await swapRouter.weth()).eq(bnb.address)
    expect(await swapRouter.minExecutionFee()).eq(minExecutionFee)
    expect(await swapRouter.admin()).eq(wallet.address)
    expect(await swapRouter.gov()).eq(wallet.address)
  })

  it("setAdmin", async () => {
    await expect(swapRouter.connect(user0).setAdmin(user1.address))
      .to.be.revertedWith("Governable: forbidden")

    await swapRouter.setGov(user0.address)

    expect(await swapRouter.admin()).eq(wallet.address)
    await swapRouter.connect(user0).setAdmin(user1.address)
    expect(await swapRouter.admin()).eq(user1.address)
  })

  it("approve", async () => {
    await expect(swapRouter.connect(user0).approve(bnb.address, user1.address, 100))
      .to.be.revertedWith("Governable: forbidden")

    await swapRouter.setGov(user0.address)

    expect(await bnb.allowance(swapRouter.address, user1.address)).eq(0)
    await swapRouter.connect(user0).approve(bnb.address, user1.address, 100)
    expect(await bnb.allowance(swapRouter.address, user1.address)).eq(100)
  })

  it("sendValue", async () => {
    await expect(swapRouter.connect(user0).sendValue(user1.address, 0))
      .to.be.revertedWith("Governable: forbidden")

    await swapRouter.setGov(user0.address)

    await swapRouter.connect(user0).sendValue(user1.address, 0)
  })

  it("setRequestKeeper", async () => {
    await expect(swapRouter.connect(user0).setRequestKeeper(user1.address, true))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setAdmin(user0.address)

    expect(await swapRouter.isRequestKeeper(user1.address)).eq(false)
    await swapRouter.connect(user0).setRequestKeeper(user1.address, true)
    expect(await swapRouter.isRequestKeeper(user1.address)).eq(true)

    await swapRouter.connect(user0).setRequestKeeper(user1.address, false)
    expect(await swapRouter.isRequestKeeper(user1.address)).eq(false)
  })

  it("setMinExecutionFee", async () => {
    await expect(swapRouter.connect(user0).setMinExecutionFee("7000"))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setAdmin(user0.address)

    expect(await swapRouter.minExecutionFee()).eq(minExecutionFee)
    await swapRouter.connect(user0).setMinExecutionFee("7000")
    expect(await swapRouter.minExecutionFee()).eq("7000")
  })

  it("setDelayValues", async () => {
    await expect(swapRouter.connect(user0).setDelayValues(7, 21, 600))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setAdmin(user0.address)

    expect(await swapRouter.minBlockDelayKeeper()).eq(0)
    expect(await swapRouter.minTimeDelayPublic()).eq(0)
    expect(await swapRouter.maxTimeDelay()).eq(0)

    await swapRouter.connect(user0).setDelayValues(7, 21, 600)

    expect(await swapRouter.minBlockDelayKeeper()).eq(7)
    expect(await swapRouter.minTimeDelayPublic()).eq(21)
    expect(await swapRouter.maxTimeDelay()).eq(600)
  })

  it("setRequestKeysStartValue", async () => {
    await expect(swapRouter.connect(user0).setRequestKeysStartValue(5))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setAdmin(user0.address)

    expect(await swapRouter.swapRequestKeysStart()).eq(0)

    await swapRouter.connect(user0).setRequestKeysStartValue(5)

    expect(await swapRouter.swapRequestKeysStart()).eq(5)
  })

  it("swap acceptableRatio", async () => {
    await swapRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    let params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(2, 30).div(bigNumberify(300)), // _acceptableRatio
      4000, // _executionFee
      false, // _isETHOut
    ]

    await router.addPlugin(swapRouter.address)
    await router.connect(user0).approvePlugin(swapRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await swapRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await expect(swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("SwapRouter: price ratio lower than limit")
  })

  it("swap minOut", async () => {
    await swapRouter.setDelayValues(0, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    let params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(3, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(1, 30).div(bigNumberify(400)), // _acceptableRatio
      4000, // _executionFee
      false, // _isETHOut
    ]

    await router.addPlugin(swapRouter.address)
    await router.connect(user0).approvePlugin(swapRouter.address)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await swapRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await expect(swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("SwapRouter: insufficient amountOut")
  })

  it("validateExecution", async () => {
    await swapRouter.setDelayValues(5, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    let params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(1, 30).div(bigNumberify(400)), // _acceptableRatio
      4000, // _executionFee
      false, // _isETHOut
    ]

    await router.addPlugin(swapRouter.address)
    await router.connect(user0).approvePlugin(swapRouter.address)

    let key = await swapRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await expect(swapRouter.connect(user1).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await expect(swapRouter.connect(user0).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 200)
    await mineBlock(provider)

    await expect(swapRouter.connect(user0).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 110)
    await mineBlock(provider)

    let request = await swapRouter.swapRequests(key)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)
    expect(request.account).eq(user0.address)

    await swapRouter.connect(user0).executeSwap(key, executionFeeReceiver.address)

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })

    await increaseTime(provider, 510)
    await mineBlock(provider)

    key = await swapRouter.getRequestKey(user0.address, 2)
    await expect(swapRouter.connect(user0).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: request has expired")
  })

  it("validateCancellation", async () => {
    await swapRouter.setDelayValues(5, 300, 500)
    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    let params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(1, 30).div(bigNumberify(400)), // _acceptableRatio
      4000, // _executionFee
      false, // _isETHOut
    ]

    await router.addPlugin(swapRouter.address)
    await router.connect(user0).approvePlugin(swapRouter.address)

    let key = await swapRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await swapRouter.connect(positionKeeper).cancelSwap(key, executionFeeReceiver.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await expect(swapRouter.connect(user1).cancelSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await expect(swapRouter.connect(user0).cancelSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 200)
    await mineBlock(provider)

    await expect(swapRouter.connect(user0).cancelSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 110)
    await mineBlock(provider)

    let request = await swapRouter.swapRequests(key)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)
    expect(request.account).eq(user0.address)

    await swapRouter.connect(user0).cancelSwap(key, executionFeeReceiver.address)

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })

    await increaseTime(provider, 1000)
    await mineBlock(provider)

    key = await swapRouter.getRequestKey(user0.address, 2)

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user0.address)

    await swapRouter.connect(user0).cancelSwap(key, executionFeeReceiver.address)

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(AddressZero)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)
  })

  it("createSwap, executeSwap, cancelSwap", async () => {
    const params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(1, 30).div(bigNumberify(400)), // _acceptableRatio
      4000, // _executionFee
      false, // _isETHOut
    ]

    params[5] = 3000
    await expect(swapRouter.connect(user0).createSwap(...params))
      .to.be.revertedWith("SwapRouter: invalid executionFee")

    params[5] = 4000
    await expect(swapRouter.connect(user0).createSwap(...params))
      .to.be.revertedWith("SwapRouter: invalid msg.value")

    await expect(swapRouter.connect(user0).createSwap(...params, { value: 3000 }))
      .to.be.revertedWith("SwapRouter: invalid msg.value")

    params[0] = []
    await expect(swapRouter.connect(user0).createSwap(...params, { value: 4000 }))
      .to.be.revertedWith("SwapRouter: invalid _path length")

    params[0] = [dai.address, bnb.address, bnb.address]

    await expect(swapRouter.connect(user0).createSwap(...params, { value: 4000 }))
      .to.be.revertedWith("SwapRouter: invalid _path length")

    params[0] = [dai.address, bnb.address]

    await expect(swapRouter.connect(user0).createSwap(...params, { value: 4000 }))
      .to.be.revertedWith("Router: invalid plugin")

    await router.addPlugin(swapRouter.address)

    await expect(swapRouter.connect(user0).createSwap(...params, { value: 4000 }))
      .to.be.revertedWith("Router: plugin not approved")

    await router.connect(user0).approvePlugin(swapRouter.address)

    await expect(swapRouter.connect(user0).createSwap(...params, { value: 4000 }))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance")

    await dai.mint(user0.address, expandDecimals(600, 18))

    await expect(swapRouter.connect(user0).createSwap(...params, { value: 4000 }))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))

    let key = await swapRouter.getRequestKey(user0.address, 1)
    let request = await swapRouter.swapRequests(key)

    expect(await dai.balanceOf(swapRouter.address)).eq(0)
    expect(await swapRouter.swapsIndex(user0.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.receiver).eq(AddressZero)
    expect(request.acceptableRatio).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)
    expect(request.isETHOut).eq(false)

    let queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(0) // swapRequestKeys.length

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(swapRouter.address)).eq(0)

    const tx0 = await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await reportGasUsed(provider, tx0, "createSwap gas used")

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(4000)
    expect(await dai.balanceOf(swapRouter.address)).eq(expandDecimals(600, 18))

    const blockNumber = await provider.getBlockNumber()
    const blockTime = await getBlockTime(provider)

    request = await swapRouter.swapRequests(key)

    expect(await swapRouter.swapsIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.path).eq(undefined)
    expect(request.amountIn).eq(expandDecimals(600, 18))
    expect(request.minOut).eq(expandDecimals(1, 18))
    expect(request.acceptableRatio).eq(expandDecimals(1, 30).div(bigNumberify(400)))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.isETHIn).eq(false)
    expect(request.isETHOut).eq(false)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(1) // swapRequestKeys.length

    await swapRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await expect(swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    // executeSwap will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address)

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await expect(swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")

    await bnb.mint(vault.address, expandDecimals(30, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeSwap gas used")

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(swapRouter.address)).eq(0)

    request = await swapRouter.swapRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.receiver).eq(AddressZero)
    expect(request.acceptableRatio).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)
    expect(request.isETHOut).eq(false)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(1) // swapRequestKeys.length

    await dai.mint(user1.address, expandDecimals(600, 18))
    await dai.connect(user1).approve(router.address, expandDecimals(600, 18))
    await router.connect(user1).approvePlugin(swapRouter.address)

    await swapRouter.connect(user1).createSwap(...params, { value: 4000 })

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(4000)
    expect(await dai.balanceOf(swapRouter.address)).eq(expandDecimals(600, 18))
    expect(await dai.balanceOf(user1.address)).eq(0)

    key = await swapRouter.getRequestKey(user1.address, 1)
    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user1.address)

    await swapRouter.connect(positionKeeper).cancelSwap(key, executionFeeReceiver.address)
    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user1.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const tx2 = await swapRouter.connect(positionKeeper).cancelSwap(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx2, "cancelSwap gas used")

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(expandDecimals(600, 18))

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(2) // swapRequestKeys.length
  })

  it("createSwapETHToTokens, executeSwap, cancelSwap", async () => {
    const params = [
      [dai.address, bnb.address], // _path
      expandDecimals(290, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(290, 30), // _acceptableRatio
    ]

    await expect(swapRouter.connect(user0).createSwapETHToTokens(...params.concat([3000])))
      .to.be.revertedWith("SwapRouter: invalid executionFee")

    await expect(swapRouter.connect(user0).createSwapETHToTokens(...params.concat([4000])), { value: 3000 })
      .to.be.revertedWith("SwapRouter: invalid msg.value")

    await expect(swapRouter.connect(user0).createSwapETHToTokens(...params.concat([4000]), { value: 4000 }))
      .to.be.revertedWith("SwapRouter: invalid _path")

    params[0] = []
    await expect(swapRouter.connect(user0).createSwapETHToTokens(...params.concat([4000]), { value: 4000 }))
      .to.be.revertedWith("SwapRouter: invalid _path length")

    params[0] = [bnb.address, dai.address, dai.address]
    await expect(swapRouter.connect(user0).createSwapETHToTokens(...params.concat([4000]), { value: 4000 }))
      .to.be.revertedWith("SwapRouter: invalid _path length")

    params[0] = [bnb.address, dai.address]

    key = await swapRouter.getRequestKey(user0.address, 1)
    let request = await swapRouter.swapRequests(key)

    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await swapRouter.swapsIndex(user0.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.receiver).eq(AddressZero)
    expect(request.acceptableRatio).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)
    expect(request.isETHOut).eq(false)

    let queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(0) // swapRequestKeys.length

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(swapRouter.address)).eq(0)

    const tx = await swapRouter.connect(user0).createSwapETHToTokens(...params.concat([4000]), { value: expandDecimals(1, 18).add(4000) })
    await reportGasUsed(provider, tx, "createSwapETHToTokens gas used")

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await dai.balanceOf(swapRouter.address)).eq(0)

    const blockNumber = await provider.getBlockNumber()
    const blockTime = await getBlockTime(provider)

    request = await swapRouter.swapRequests(key)

    expect(await bnb.balanceOf(swapRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await swapRouter.swapsIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.path).eq(undefined)
    expect(request.amountIn).eq(expandDecimals(1, 18))
    expect(request.minOut).eq(expandDecimals(290, 18))
    expect(request.receiver).eq(user0.address)
    expect(request.acceptableRatio).eq(expandDecimals(290, 30))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.isETHIn).eq(true)
    expect(request.isETHOut).eq(false)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(1) // swapRequestKeys.length

    await swapRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await expect(swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    // executeSwap will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address)

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await expect(swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")

    await dai.mint(vault.address, expandDecimals(7000, 18))
    await vault.buyUSDF(dai.address, user1.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await swapRouter.connect(positionKeeper).executeSwap(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeSwap gas used")

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(swapRouter.address)).eq(0)

    request = await swapRouter.swapRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.path).eq(undefined)
    expect(request.amountIn).eq(0)
    expect(request.minOut).eq(0)
    expect(request.receiver).eq(AddressZero)
    expect(request.acceptableRatio).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)
    expect(request.isETHOut).eq(false)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(1) // swapRequestKeys.length

    await router.connect(user1).approvePlugin(swapRouter.address)
    await swapRouter.connect(user1).createSwapETHToTokens(...params.concat([4000]), { value: expandDecimals(1, 18).add(4000) })

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect(await bnb.balanceOf(swapRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await dai.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)

    key = await swapRouter.getRequestKey(user1.address, 1)
    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user1.address)

    await swapRouter.connect(positionKeeper).cancelSwap(key, executionFeeReceiver.address)
    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(user1.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const balanceBefore = await provider.getBalance(user1.address)
    const tx2 = await swapRouter.connect(positionKeeper).cancelSwap(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx2, "cancelSwap gas used")

    request = await swapRouter.swapRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(swapRouter.address)).eq(0)
    expect((await provider.getBalance(user1.address)).sub(balanceBefore)).eq(expandDecimals(1, 18))
    expect(await bnb.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(swapRouter.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    await router.connect(user2).approvePlugin(swapRouter.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(2) // swapRequestKeys.length
  })

  it("executeSwaps", async () => {
    await swapRouter.setDelayValues(5, 300, 500)
    const executionFeeReceiver = newWallet()

    await bnb.mint(vault.address, expandDecimals(500, 18))
    await vault.buyUSDF(bnb.address, user1.address)

    await router.addPlugin(swapRouter.address)
    await router.connect(user0).approvePlugin(swapRouter.address)
    await router.connect(user1).approvePlugin(swapRouter.address)
    await router.connect(user2).approvePlugin(swapRouter.address)

    await expect(swapRouter.connect(positionKeeper).executeSwaps(100, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await swapRouter.setRequestKeeper(positionKeeper.address, true)

    let queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(0) // swapRequestKeys.length

    await swapRouter.connect(positionKeeper).executeSwaps(100, executionFeeReceiver.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(0) // swapRequestKeys.length

    const params = [
      [dai.address, bnb.address], // _path
      expandDecimals(600, 18), // _amountIn
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      expandDecimals(1, 30).div(bigNumberify(400)), // _acceptableRatio
      4000, // _executionFee
      false, // _isETHOut
    ]

    await router.addPlugin(swapRouter.address)

    await router.connect(user0).approvePlugin(swapRouter.address)
    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))
    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })

    let key0 = await swapRouter.getRequestKey(user0.address, 1)
    let request0 = await swapRouter.swapRequests(key0)
    expect(request0.account).eq(user0.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(1) // swapRequestKeys.length

    await router.connect(user1).approvePlugin(swapRouter.address)
    await dai.mint(user1.address, expandDecimals(600, 18))
    await dai.connect(user1).approve(router.address, expandDecimals(600, 18))
    await swapRouter.connect(user1).createSwap(...params, { value: 4000 })

    let key1 = await swapRouter.getRequestKey(user1.address, 1)
    let request1 = await swapRouter.swapRequests(key1)
    expect(request1.account).eq(user1.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(2) // swapRequestKeys.length

    await router.connect(user2).approvePlugin(swapRouter.address)
    await dai.mint(user2.address, expandDecimals(600, 18))
    await dai.connect(user2).approve(router.address, expandDecimals(600, 18))
    await swapRouter.connect(user2).createSwap(...params, { value: 4000 })

    let key2 = await swapRouter.getRequestKey(user2.address, 1)
    let request2 = await swapRouter.swapRequests(key2)
    expect(request2.account).eq(user2.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(3) // swapRequestKeys.length

    params[1] = expandDecimals(900, 18) // amountIn
    params[2] = expandDecimals(4, 18) // minOut

    await router.connect(user3).approvePlugin(swapRouter.address)
    await dai.mint(user3.address, expandDecimals(900, 18))
    await dai.connect(user3).approve(router.address, expandDecimals(900, 18))
    await swapRouter.connect(user3).createSwap(...params, { value: 4000 })

    let key3 = await swapRouter.getRequestKey(user3.address, 1)
    let request3 = await swapRouter.swapRequests(key3)
    expect(request3.account).eq(user3.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(4) // swapRequestKeys.length

    params[1] = expandDecimals(1200, 18) // amountIn
    params[2] = expandDecimals(3, 18) // minOut

    await router.connect(user4).approvePlugin(swapRouter.address)
    await dai.mint(user4.address, expandDecimals(1200, 18))
    await dai.connect(user4).approve(router.address, expandDecimals(1200, 18))
    await swapRouter.connect(user4).createSwap(...params, { value: 4000 })

    let key4 = await swapRouter.getRequestKey(user4.address, 1)
    let request4 = await swapRouter.swapRequests(key4)
    expect(request4.account).eq(user4.address)

    await swapRouter.connect(positionKeeper).executeSwap(key2, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    expect((await swapRouter.swapRequests(key2)).account).eq(AddressZero)

    await expect(swapRouter.connect(positionKeeper).executeSwap(key3, executionFeeReceiver.address))
      .to.be.revertedWith("SwapRouter: insufficient amountOut")

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await swapRouter.connect(positionKeeper).executeSwaps(0, executionFeeReceiver.address)
    expect((await swapRouter.swapRequests(key0)).account).eq(user0.address)
    expect((await swapRouter.swapRequests(key1)).account).eq(user1.address)
    expect((await swapRouter.swapRequests(key2)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key3)).account).eq(user3.address)
    expect((await swapRouter.swapRequests(key4)).account).eq(user4.address)

    expect(await swapRouter.swapRequestKeys(0)).eq(key0)
    expect(await swapRouter.swapRequestKeys(1)).eq(key1)
    expect(await swapRouter.swapRequestKeys(2)).eq(key2)
    expect(await swapRouter.swapRequestKeys(3)).eq(key3)
    expect(await swapRouter.swapRequestKeys(4)).eq(key4)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // swapRequestKeysStart
    expect(queueLengths[1]).eq(5) // swapRequestKeys.length

    await swapRouter.connect(positionKeeper).executeSwaps(1, executionFeeReceiver.address)
    expect((await swapRouter.swapRequests(key0)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key1)).account).eq(user1.address)
    expect((await swapRouter.swapRequests(key2)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key3)).account).eq(user3.address)
    expect((await swapRouter.swapRequests(key4)).account).eq(user4.address)

    expect(await swapRouter.swapRequestKeys(0)).eq(HashZero)
    expect(await swapRouter.swapRequestKeys(1)).eq(key1)
    expect(await swapRouter.swapRequestKeys(2)).eq(key2)
    expect(await swapRouter.swapRequestKeys(3)).eq(key3)
    expect(await swapRouter.swapRequestKeys(4)).eq(key4)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(1) // swapRequestKeysStart
    expect(queueLengths[1]).eq(5) // swapRequestKeys.length

    await swapRouter.connect(positionKeeper).executeSwaps(0, executionFeeReceiver.address)

    expect((await swapRouter.swapRequests(key0)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key1)).account).eq(user1.address)
    expect((await swapRouter.swapRequests(key2)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key3)).account).eq(user3.address)
    expect((await swapRouter.swapRequests(key4)).account).eq(user4.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(1) // swapRequestKeysStart
    expect(queueLengths[1]).eq(5) // swapRequestKeys.length

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)
    expect(await dai.balanceOf(user2.address)).eq(0)
    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await dai.balanceOf(user4.address)).eq(0)

    await swapRouter.connect(positionKeeper).executeSwaps(10, executionFeeReceiver.address)

    expect((await swapRouter.swapRequests(key0)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key1)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key2)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key3)).account).eq(AddressZero)
    expect((await swapRouter.swapRequests(key4)).account).eq(AddressZero)

    expect(await swapRouter.swapRequestKeys(0)).eq(HashZero)
    expect(await swapRouter.swapRequestKeys(1)).eq(HashZero)
    expect(await swapRouter.swapRequestKeys(2)).eq(HashZero)
    expect(await swapRouter.swapRequestKeys(3)).eq(HashZero)
    expect(await swapRouter.swapRequestKeys(4)).eq(HashZero)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // swapRequestKeysStart
    expect(queueLengths[1]).eq(5) // swapRequestKeys.length

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(20000)

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)
    expect(await dai.balanceOf(user2.address)).eq(0)
    expect(await dai.balanceOf(user3.address)).eq(expandDecimals(900, 18)) // refunded
    expect(await dai.balanceOf(user4.address)).eq(0)

    params[1] = expandDecimals(600, 18)
    params[2] = expandDecimals(1, 18)
    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))
    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })

    await dai.mint(user0.address, expandDecimals(600, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(600, 18))
    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // swapRequestKeysStart
    expect(queueLengths[1]).eq(7) // swapRequestKeys.length

    await swapRouter.connect(positionKeeper).executeSwaps(10, executionFeeReceiver.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // swapRequestKeysStart
    expect(queueLengths[1]).eq(7) // swapRequestKeys.length

    await mineBlock(provider)

    await swapRouter.connect(positionKeeper).executeSwaps(6, executionFeeReceiver.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(6) // swapRequestKeysStart
    expect(queueLengths[1]).eq(7) // swapRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await swapRouter.connect(positionKeeper).executeSwaps(6, executionFeeReceiver.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(6) // swapRequestKeysStart
    expect(queueLengths[1]).eq(7) // swapRequestKeys.length

    await swapRouter.connect(positionKeeper).executeSwaps(10, executionFeeReceiver.address)

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // swapRequestKeysStart
    expect(queueLengths[1]).eq(7) // swapRequestKeys.length

    await dai.mint(user0.address, expandDecimals(1800, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(1800, 18))

    params[1] = expandDecimals(600, 18)
    params[2] = expandDecimals(2, 18)

    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })
    await swapRouter.connect(user0).createSwap(...params, { value: 4000 })

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // swapRequestKeysStart
    expect(queueLengths[1]).eq(10) // swapRequestKeys.length

    await fastPriceFeed.setMaxTimeDeviation(1000)
    await positionRouter.setPositionKeeper(fastPriceFeed.address, true)
    await swapRouter.setRequestKeeper(fastPriceFeed.address, true)
    await liquidityRouter.setRequestKeeper(fastPriceFeed.address, true)

    const blockTime = await getBlockTime(provider)

    await expect(fastPriceFeed.connect(user0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      0, // _endIndexForIncreasePositions
      0, // _endIndexForDecreasePositions
      9, // _endIndexForSwaps
      0, // _endIndexForAddLiquidities
      0 // _endIndexForRemoeLiquidities
    )).to.be.revertedWith("FastPriceFeed: forbidden")

    await fastPriceFeed.connect(updater0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      0, // _endIndexForIncreasePositions
      0, // _endIndexForDecreasePositions
      9, // _endIndexForSwaps
      0, // _endIndexForAddLiquidities
      0 // _endIndexForRemoeLiquidities
    )

    queueLengths = await swapRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(9) // swapRequestKeysStart
    expect(queueLengths[1]).eq(10) // swapRequestKeys.length
  })
})
