const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("LiquidityRouter", function () {
  const { AddressZero, HashZero } = ethers.constants
  const provider = waffle.provider
  const [wallet, positionKeeper, minter, user0, user1, user2, user3, user4, user5, tokenManager, mintReceiver, signer0, signer1, updater0, updater1] = provider.getWallets()
  const depositFee = 50
  const minExecutionFee = 4000
  const vestingDuration = 365 * 24 * 60 * 60

  let vault
  let flpManager
  let flp
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

  let fxdx
  let esFxdx
  let bnFxdx

  let stakedFxdxTracker
  let stakedFxdxDistributor
  let bonusFxdxTracker
  let bonusFxdxDistributor
  let feeFxdxTracker
  let feeFxdxDistributor

  let feeFlpTracker
  let feeFlpDistributor
  let stakedFlpTracker
  let stakedFlpDistributor

  let fxdxVester
  let flpVester

  let rewardRouter

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

    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    positionRouter = await deployContract("PositionRouter", [vault.address, router.address, bnb.address, depositFee, minExecutionFee])
    referralStorage = await deployContract("ReferralStorage", [])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    await positionRouter.setReferralStorage(referralStorage.address)
    await referralStorage.setHandler(positionRouter.address, true)
    flp = await deployContract("FLP", [])

    const { feeUtils } = await initVault(vault, router, usdf, vaultPriceFeed)
    flpManager = await deployContract("FlpManager", [vault.address, usdf.address, flp.address, 5])

    timelock = await deployContract("Timelock", [
      wallet.address,
      10,
      tokenManager.address,
      tokenManager.address,
      flpManager.address,
      expandDecimals(1000000, 18)
    ])

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

    await flp.setInPrivateTransferMode(true)
    await flp.setMinter(flpManager.address, true)
    await flpManager.setInPrivateMode(true)

    fxdx = await deployContract("FXDX", []);
    esFxdx = await deployContract("EsFXDX", []);
    bnFxdx = await deployContract("MintableBaseToken", ["Bonus FXDX", "bnFXDX", 0]);

    // FXDX
    stakedFxdxTracker = await deployContract("RewardTracker", ["Staked FXDX", "sFXDX"])
    stakedFxdxDistributor = await deployContract("RewardDistributor", [esFxdx.address, stakedFxdxTracker.address])
    await stakedFxdxTracker.initialize([fxdx.address, esFxdx.address], stakedFxdxDistributor.address)
    await stakedFxdxDistributor.updateLastDistributionTime()

    bonusFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus FXDX", "sbFXDX"])
    bonusFxdxDistributor = await deployContract("BonusDistributor", [bnFxdx.address, bonusFxdxTracker.address])
    await bonusFxdxTracker.initialize([stakedFxdxTracker.address], bonusFxdxDistributor.address)
    await bonusFxdxDistributor.updateLastDistributionTime()

    feeFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee FXDX", "sbfFXDX"])
    feeFxdxDistributor = await deployContract("RewardDistributor", [eth.address, feeFxdxTracker.address])
    await feeFxdxTracker.initialize([bonusFxdxTracker.address, bnFxdx.address], feeFxdxDistributor.address)
    await feeFxdxDistributor.updateLastDistributionTime()

    // FLP
    feeFlpTracker = await deployContract("RewardTracker", ["Fee FLP", "fFLP"])
    feeFlpDistributor = await deployContract("RewardDistributor", [eth.address, feeFlpTracker.address])
    await feeFlpTracker.initialize([flp.address], feeFlpDistributor.address)
    await feeFlpDistributor.updateLastDistributionTime()

    stakedFlpTracker = await deployContract("RewardTracker", ["Fee + Staked FLP", "fsFLP"])
    stakedFlpDistributor = await deployContract("RewardDistributor", [esFxdx.address, stakedFlpTracker.address])
    await stakedFlpTracker.initialize([feeFlpTracker.address], stakedFlpDistributor.address)
    await stakedFlpDistributor.updateLastDistributionTime()

    fxdxVester = await deployContract("Vester", [
      "Vested FXDX", // _name
      "vFXDX", // _symbol
      vestingDuration, // _vestingDuration
      esFxdx.address, // _esToken
      feeFxdxTracker.address, // _pairToken
      fxdx.address, // _claimableToken
      stakedFxdxTracker.address, // _rewardTracker
    ])

    flpVester = await deployContract("Vester", [
      "Vested FLP", // _name
      "vFLP", // _symbol
      vestingDuration, // _vestingDuration
      esFxdx.address, // _esToken
      stakedFlpTracker.address, // _pairToken
      fxdx.address, // _claimableToken
      stakedFlpTracker.address, // _rewardTracker
    ])

    await stakedFxdxTracker.setInPrivateTransferMode(true)
    await stakedFxdxTracker.setInPrivateStakingMode(true)
    await bonusFxdxTracker.setInPrivateTransferMode(true)
    await bonusFxdxTracker.setInPrivateStakingMode(true)
    await bonusFxdxTracker.setInPrivateClaimingMode(true)
    await feeFxdxTracker.setInPrivateTransferMode(true)
    await feeFxdxTracker.setInPrivateStakingMode(true)

    await feeFlpTracker.setInPrivateTransferMode(true)
    await feeFlpTracker.setInPrivateStakingMode(true)
    await stakedFlpTracker.setInPrivateTransferMode(true)
    await stakedFlpTracker.setInPrivateStakingMode(true)

    await esFxdx.setInPrivateTransferMode(true)

    rewardRouter = await deployContract("RewardRouterV2", [])
    await rewardRouter.initialize(
      vault.address,
      bnb.address,
      fxdx.address,
      esFxdx.address,
      bnFxdx.address,
      flp.address,
      stakedFxdxTracker.address,
      bonusFxdxTracker.address,
      feeFxdxTracker.address,
      feeFlpTracker.address,
      stakedFlpTracker.address,
      flpManager.address,
      fxdxVester.address,
      flpVester.address
    )

    // allow bonusFxdxTracker to stake stakedFxdxTracker
    await stakedFxdxTracker.setHandler(bonusFxdxTracker.address, true)
    // allow bonusFxdxTracker to stake feeFxdxTracker
    await bonusFxdxTracker.setHandler(feeFxdxTracker.address, true)
    await bonusFxdxDistributor.setBonusMultiplier(10000)
    // allow feeFxdxTracker to stake bnFxdx
    await bnFxdx.setHandler(feeFxdxTracker.address, true)

    // allow stakedFlpTracker to stake feeFlpTracker
    await feeFlpTracker.setHandler(stakedFlpTracker.address, true)
    // allow feeFlpTracker to stake flp
    await flp.setHandler(feeFlpTracker.address, true)

    // mint esFxdx for distributors
    await esFxdx.setMinter(wallet.address, true)
    await esFxdx.mint(stakedFxdxDistributor.address, expandDecimals(50000, 18))
    await stakedFxdxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esFxdx per second
    await esFxdx.mint(stakedFlpDistributor.address, expandDecimals(50000, 18))
    await stakedFlpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esFxdx per second

    // mint bnFxdx for distributor
    await bnFxdx.setMinter(wallet.address, true)
    await bnFxdx.mint(bonusFxdxDistributor.address, expandDecimals(1500, 18))

    await esFxdx.setHandler(tokenManager.address, true)
    await fxdxVester.setHandler(wallet.address, true)

    await esFxdx.setHandler(rewardRouter.address, true)
    await esFxdx.setHandler(stakedFxdxDistributor.address, true)
    await esFxdx.setHandler(stakedFlpDistributor.address, true)
    await esFxdx.setHandler(stakedFxdxTracker.address, true)
    await esFxdx.setHandler(stakedFlpTracker.address, true)
    await esFxdx.setHandler(fxdxVester.address, true)
    await esFxdx.setHandler(flpVester.address, true)

    await flpManager.setHandler(rewardRouter.address, true)
    await stakedFxdxTracker.setHandler(rewardRouter.address, true)
    await bonusFxdxTracker.setHandler(rewardRouter.address, true)
    await feeFxdxTracker.setHandler(rewardRouter.address, true)
    await feeFlpTracker.setHandler(rewardRouter.address, true)
    await stakedFlpTracker.setHandler(rewardRouter.address, true)

    await esFxdx.setHandler(rewardRouter.address, true)
    await bnFxdx.setMinter(rewardRouter.address, true)
    await esFxdx.setMinter(fxdxVester.address, true)
    await esFxdx.setMinter(flpVester.address, true)

    await fxdxVester.setHandler(rewardRouter.address, true)
    await flpVester.setHandler(rewardRouter.address, true)

    await feeFxdxTracker.setHandler(fxdxVester.address, true)
    await stakedFlpTracker.setHandler(flpVester.address, true)

    await flpManager.setGov(timelock.address)
    await stakedFxdxTracker.setGov(timelock.address)
    await bonusFxdxTracker.setGov(timelock.address)
    await feeFxdxTracker.setGov(timelock.address)
    await feeFlpTracker.setGov(timelock.address)
    await stakedFlpTracker.setGov(timelock.address)
    await stakedFxdxDistributor.setGov(timelock.address)
    await stakedFlpDistributor.setGov(timelock.address)
    await esFxdx.setGov(timelock.address)
    await bnFxdx.setGov(timelock.address)
    await fxdxVester.setGov(timelock.address)
    await flpVester.setGov(timelock.address)

    swapRouter = await deployContract("SwapRouter", [vault.address, router.address, bnb.address, minExecutionFee])
    liquidityRouter = await deployContract("LiquidityRouter", [vault.address, router.address, rewardRouter.address, bnb.address, minExecutionFee])

    await liquidityRouter.setReferralStorage(referralStorage.address)
    await referralStorage.setHandler(liquidityRouter.address, true)

    await feeUtils.setGov(timelock.address)
    await timelock.setContractHandler(liquidityRouter.address, true)

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
  })

  it("inits", async () => {
    expect(await liquidityRouter.vault()).eq(vault.address)
    expect(await liquidityRouter.router()).eq(router.address)
    expect(await liquidityRouter.weth()).eq(bnb.address)
    expect(await liquidityRouter.minExecutionFee()).eq(minExecutionFee)
    expect(await liquidityRouter.admin()).eq(wallet.address)
    expect(await liquidityRouter.gov()).eq(wallet.address)
  })

  it("setAdmin", async () => {
    await expect(liquidityRouter.connect(user0).setAdmin(user1.address))
      .to.be.revertedWith("Governable: forbidden")

    await liquidityRouter.setGov(user0.address)

    expect(await liquidityRouter.admin()).eq(wallet.address)
    await liquidityRouter.connect(user0).setAdmin(user1.address)
    expect(await liquidityRouter.admin()).eq(user1.address)
  })

  it("approve", async () => {
    await expect(liquidityRouter.connect(user0).approve(bnb.address, user1.address, 100))
      .to.be.revertedWith("Governable: forbidden")

    await liquidityRouter.setGov(user0.address)

    expect(await bnb.allowance(liquidityRouter.address, user1.address)).eq(0)
    await liquidityRouter.connect(user0).approve(bnb.address, user1.address, 100)
    expect(await bnb.allowance(liquidityRouter.address, user1.address)).eq(100)
  })

  it("sendValue", async () => {
    await expect(liquidityRouter.connect(user0).sendValue(user1.address, 0))
      .to.be.revertedWith("Governable: forbidden")

    await liquidityRouter.setGov(user0.address)

    await liquidityRouter.connect(user0).sendValue(user1.address, 0)
  })

  it("setRequestKeeper", async () => {
    await expect(liquidityRouter.connect(user0).setRequestKeeper(user1.address, true))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setAdmin(user0.address)

    expect(await liquidityRouter.isRequestKeeper(user1.address)).eq(false)
    await liquidityRouter.connect(user0).setRequestKeeper(user1.address, true)
    expect(await liquidityRouter.isRequestKeeper(user1.address)).eq(true)

    await liquidityRouter.connect(user0).setRequestKeeper(user1.address, false)
    expect(await liquidityRouter.isRequestKeeper(user1.address)).eq(false)
  })

  it("setMinExecutionFee", async () => {
    await expect(liquidityRouter.connect(user0).setMinExecutionFee("7000"))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setAdmin(user0.address)

    expect(await liquidityRouter.minExecutionFee()).eq(minExecutionFee)
    await liquidityRouter.connect(user0).setMinExecutionFee("7000")
    expect(await liquidityRouter.minExecutionFee()).eq("7000")
  })

  it("setDelayValues", async () => {
    await expect(liquidityRouter.connect(user0).setDelayValues(7, 21, 600))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setAdmin(user0.address)

    expect(await liquidityRouter.minBlockDelayKeeper()).eq(0)
    expect(await liquidityRouter.minTimeDelayPublic()).eq(0)
    expect(await liquidityRouter.maxTimeDelay()).eq(0)

    await liquidityRouter.connect(user0).setDelayValues(7, 21, 600)

    expect(await liquidityRouter.minBlockDelayKeeper()).eq(7)
    expect(await liquidityRouter.minTimeDelayPublic()).eq(21)
    expect(await liquidityRouter.maxTimeDelay()).eq(600)
  })

  it("setReferralStorage", async () => {
    await expect(liquidityRouter.connect(user0).setReferralStorage(user1.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setAdmin(user0.address)

    expect(await liquidityRouter.referralStorage()).eq(referralStorage.address)
    await liquidityRouter.connect(user0).setReferralStorage(user1.address)
    expect(await liquidityRouter.referralStorage()).eq(user1.address)
  })

  it("setRequestKeysStartValues", async () => {
    await expect(liquidityRouter.connect(user0).setRequestKeysStartValues(5, 8))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setAdmin(user0.address)

    expect(await liquidityRouter.addLiquidityRequestKeysStart()).eq(0)
    expect(await liquidityRouter.removeLiquidityRequestKeysStart()).eq(0)

    await liquidityRouter.connect(user0).setRequestKeysStartValues(5, 8)

    expect(await liquidityRouter.addLiquidityRequestKeysStart()).eq(5)
    expect(await liquidityRouter.removeLiquidityRequestKeysStart()).eq(8)
  })

  it("addLiquidity acceptablePrice, referralCode check", async () => {
    await liquidityRouter.setDelayValues(0, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(1, 18), // _amountIn
      expandDecimals(290, 18), // _minUsdf
      expandDecimals(290, 18), // _minFlp
      toUsd(310), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    expect(await referralStorage.traderReferralCodes(user0.address)).eq(referralCode)

    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("LiquidityRouter: mark price lower than limit")
  })

  it("addLiquidity minUsdf", async () => {
    await liquidityRouter.setDelayValues(0, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(1, 18), // _amountIn
      expandDecimals(310, 18), // _minUsdf
      expandDecimals(290, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("FlpManager: insufficient USDF output")
  })

  it("addLiquidity minFlp", async () => {
    await liquidityRouter.setDelayValues(0, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(1, 18), // _amountIn
      expandDecimals(290, 18), // _minUsdf
      expandDecimals(310, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("FlpManager: insufficient FLP output")
  })

  it("validateExecution", async () => {
    await liquidityRouter.setDelayValues(5, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(1, 18), // _amountIn
      expandDecimals(290, 18), // _minUsdf
      expandDecimals(290, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await expect(liquidityRouter.connect(user1).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await expect(liquidityRouter.connect(user0).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 200)
    await mineBlock(provider)

    await expect(liquidityRouter.connect(user0).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 110)
    await mineBlock(provider)

    let request = await liquidityRouter.addLiquidityRequests(key)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)
    expect(request.account).eq(user0.address)

    await liquidityRouter.connect(user0).executeAddLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    await increaseTime(provider, 510)
    await mineBlock(provider)

    key = await liquidityRouter.getRequestKey(user0.address, 2)
    await expect(liquidityRouter.connect(user0).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: request has expired")
  })

  it("validateCancellation", async () => {
    await liquidityRouter.setDelayValues(5, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(1, 18), // _amountIn
      expandDecimals(290, 18), // _minUsdf
      expandDecimals(290, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await liquidityRouter.connect(positionKeeper).cancelAddLiquidity(key, executionFeeReceiver.address)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await expect(liquidityRouter.connect(user1).cancelAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await expect(liquidityRouter.connect(user0).cancelAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 200)
    await mineBlock(provider)

    await expect(liquidityRouter.connect(user0).cancelAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: min delay not yet passed")

    await increaseTime(provider, 110)
    await mineBlock(provider)

    let request = await liquidityRouter.addLiquidityRequests(key)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)
    expect(request.account).eq(user0.address)

    await liquidityRouter.connect(user0).cancelAddLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)
    expect(await vault.guaranteedUsd(bnb.address)).eq(0)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(1, 18))

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    await increaseTime(provider, 1000)
    await mineBlock(provider)

    key = await liquidityRouter.getRequestKey(user0.address, 2)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await liquidityRouter.connect(user0).cancelAddLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(AddressZero)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)
  })

  it("removeLiquidity acceptablePrice", async () => {
    await liquidityRouter.setDelayValues(0, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(2, 18), // _amountIn
      expandDecimals(590, 18), // _minUsdf
      expandDecimals(590, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)

    let removeLiquidityParams = [
      bnb.address, // _tokenOut
      expandDecimals(590, 18), // _flpAmount
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      toUsd(290), // _acceptablePrice
    ]

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, false]), { value: 4000 })
    key = await liquidityRouter.getRequestKey(user0.address, 1)
    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("LiquidityRouter: mark price higher than limit")
  })

  it("removeLiquidity cooldownDuration minOut", async () => {
    await liquidityRouter.setDelayValues(0, 300, 500)

    let params = [
      bnb.address, // _token
      expandDecimals(2, 18), // _amountIn
      expandDecimals(590, 18), // _minUsdf
      expandDecimals(590, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)

    let removeLiquidityParams = [
      bnb.address, // _tokenOut
      expandDecimals(590, 18), // _flpAmount
      expandDecimals(2, 18), // _minOut
      user0.address, // _receiver
      toUsd(310), // _acceptablePrice
    ]

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, false]), { value: 4000 })
    key = await liquidityRouter.getRequestKey(user0.address, 1)

    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("FlpManager: cooldown duration not yet passed")

    await increaseTime(provider, 10)

    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("FlpManager: insufficient output")
  })

  it("createAddLiquidity, executeAddLiquidity, cancelAddLiquidity", async () => {
    let params = [
      bnb.address, // _token
      expandDecimals(2, 18), // _amountIn
      expandDecimals(590, 18), // _minUsdf
      expandDecimals(590, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([3000, referralCode])))
      .to.be.revertedWith("LiquidityRouter: invalid executionFee")

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode])))
      .to.be.revertedWith("LiquidityRouter: invalid msg.value")

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 3000 }))
      .to.be.revertedWith("LiquidityRouter: invalid msg.value")

    params[1] = 0
    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("LiquidityRouter: invalid _amountIn")

    params[1] = expandDecimals(2, 18)

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("Router: invalid plugin")

    await router.addPlugin(liquidityRouter.address)

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("Router: plugin not approved")

    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance")

    await bnb.mint(user0.address, expandDecimals(2, 18))

    await expect(liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)
    let request = await liquidityRouter.addLiquidityRequests(key)

    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)
    expect(await liquidityRouter.addLiquiditiesIndex(user0.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.token).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minUsdf).eq(0)
    expect(request.minFlp).eq(0)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)

    let queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(0) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    const tx0 = await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await reportGasUsed(provider, tx0, "createAddLiquidity gas used")

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(expandDecimals(2, 18).add(4000))

    const blockNumber = await provider.getBlockNumber()
    const blockTime = await getBlockTime(provider)

    request = await liquidityRouter.addLiquidityRequests(key)

    expect(await liquidityRouter.addLiquiditiesIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.token).eq(bnb.address)
    expect(request.amountIn).eq(expandDecimals(2, 18))
    expect(request.minUsdf).eq(expandDecimals(590, 18))
    expect(request.minFlp).eq(expandDecimals(590, 18))
    expect(request.acceptablePrice).eq(toUsd(290))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.isETHIn).eq(false)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    // executeAddLiquidity will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("RewardRouter: forbidden")

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeAddLiquidity gas used")

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    request = await liquidityRouter.addLiquidityRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.token).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minUsdf).eq(0)
    expect(request.minFlp).eq(0)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(router.address, expandDecimals(2, 18))
    await router.connect(user1).approvePlugin(liquidityRouter.address)

    await liquidityRouter.connect(user1).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(expandDecimals(2, 18).add(4000))

    key = await liquidityRouter.getRequestKey(user1.address, 1)
    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user1.address)

    await liquidityRouter.connect(positionKeeper).cancelAddLiquidity(key, executionFeeReceiver.address)
    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user1.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const tx2 = await liquidityRouter.connect(positionKeeper).cancelAddLiquidity(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx2, "cancelAddLiquidity gas used")

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(expandDecimals(2, 18))

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(2) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length
  })

  it("createAddLiquidityETH, executeAddLiquidity, cancelAddLiquidity", async () => {
    let params = [
      expandDecimals(290, 18), // _minUsdf
      expandDecimals(290, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await expect(liquidityRouter.connect(user0).createAddLiquidityETH(...params.concat([3000, referralCode])))
      .to.be.revertedWith("LiquidityRouter: invalid executionFee")

    await expect(liquidityRouter.connect(user0).createAddLiquidityETH(...params.concat([4000, referralCode])), { value: 3000 })
      .to.be.revertedWith("LiquidityRouter: invalid msg.value")

    await expect(liquidityRouter.connect(user0).createAddLiquidityETH(...params.concat([4000, referralCode]), { value: 4000 }))
      .to.be.revertedWith("LiquidityRouter: invalid amountIn")

    key = await liquidityRouter.getRequestKey(user0.address, 1)
    let request = await liquidityRouter.addLiquidityRequests(key)

    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.token).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minUsdf).eq(0)
    expect(request.minFlp).eq(0)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)

    let queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(0) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    const tx = await liquidityRouter.connect(user0).createAddLiquidityETH(...params.concat([4000, referralCode]), { value: expandDecimals(1, 18).add(4000) })
    await reportGasUsed(provider, tx, "createAddLiquidityETH gas used")

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(expandDecimals(1, 18).add(4000))

    const blockNumber = await provider.getBlockNumber()
    const blockTime = await getBlockTime(provider)

    request = await liquidityRouter.addLiquidityRequests(key)

    expect(await bnb.balanceOf(liquidityRouter.address)).eq(expandDecimals(1, 18).add(4000))
    expect(await liquidityRouter.addLiquiditiesIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.token).eq(bnb.address)
    expect(request.amountIn).eq(expandDecimals(1, 18))
    expect(request.minUsdf).eq(expandDecimals(290, 18))
    expect(request.minFlp).eq(expandDecimals(290, 18))
    expect(request.acceptablePrice).eq(toUsd(290))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.isETHIn).eq(true)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    // executeAddLiquidity will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("RewardRouter: forbidden")

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    const tx1 = await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeAddLiquidity gas used")

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    request = await liquidityRouter.addLiquidityRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.token).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minUsdf).eq(0)
    expect(request.minFlp).eq(0)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(user1).createAddLiquidityETH(...params.concat([4000, referralCode]), { value: expandDecimals(1, 18).add(4000) })

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(expandDecimals(1, 18).add(4000))

    key = await liquidityRouter.getRequestKey(user1.address, 1)
    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user1.address)

    await liquidityRouter.connect(positionKeeper).cancelAddLiquidity(key, executionFeeReceiver.address)
    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user1.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    const balanceBefore = await provider.getBalance(user1.address)
    const tx2 = await liquidityRouter.connect(positionKeeper).cancelAddLiquidity(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx2, "cancelAddLiquidity gas used")

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect((await provider.getBalance(user1.address)).sub(balanceBefore)).eq(expandDecimals(1, 18))
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(2) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length
  })

  it("createAddLiquidity, createRemoveLiquidity, executeRemoveLiquidity, cancelRemoveLiquidity", async () => {
    let params = [
      bnb.address, // _token
      expandDecimals(2, 18), // _amountIn
      expandDecimals(590, 18), // _minUsdf
      expandDecimals(590, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))

    let key = await liquidityRouter.getRequestKey(user0.address, 1)
    let request = await liquidityRouter.addLiquidityRequests(key)

    expect(await dai.balanceOf(liquidityRouter.address)).eq(0)

    expect(request.account).eq(AddressZero)
    expect(request.token).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minUsdf).eq(0)
    expect(request.minFlp).eq(0)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)

    let queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(0) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    const tx0 = await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await reportGasUsed(provider, tx0, "createAddLiquidity gas used")

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(expandDecimals(2, 18).add(4000))

    let blockNumber = await provider.getBlockNumber()
    let blockTime = await getBlockTime(provider)

    request = await liquidityRouter.addLiquidityRequests(key)

    expect(await liquidityRouter.addLiquiditiesIndex(user0.address)).eq(1)

    expect(request.account).eq(user0.address)
    expect(request.token).eq(bnb.address)
    expect(request.amountIn).eq(expandDecimals(2, 18))
    expect(request.minUsdf).eq(expandDecimals(590, 18))
    expect(request.minFlp).eq(expandDecimals(590, 18))
    expect(request.acceptablePrice).eq(toUsd(290))
    expect(request.executionFee).eq(4000)
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.isETHIn).eq(false)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.setDelayValues(5, 300, 500)

    const executionFeeReceiver = newWallet()
    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    // executeAddLiquidity will return without error and without executing the position if the minBlockDelayKeeper has not yet passed
    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.addLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(0)

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true);

    const tx1 = await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx1, "executeAddLiquidity gas used")

    expect(await provider.getBalance(liquidityRouter.address)).eq(0)
    expect(await bnb.balanceOf(liquidityRouter.address)).eq(0)

    request = await liquidityRouter.addLiquidityRequests(key)

    expect(request.account).eq(AddressZero)
    expect(request.token).eq(AddressZero)
    expect(request.amountIn).eq(0)
    expect(request.minUsdf).eq(0)
    expect(request.minFlp).eq(0)
    expect(request.acceptablePrice).eq(0)
    expect(request.executionFee).eq(0)
    expect(request.blockNumber).eq(0)
    expect(request.blockTime).eq(0)
    expect(request.isETHIn).eq(false)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    let removeLiquidityParams = [
      bnb.address, // _tokenOut
      expandDecimals(590, 18), // _flpAmount
      expandDecimals(1, 18), // _minOut
      user0.address, // _receiver
      toUsd(310), // _acceptablePrice
    ]

    await expect(liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([3000, false])))
      .to.be.revertedWith("LiquidityRouter: invalid executionFee")

    await expect(liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, false])))
      .to.be.revertedWith("LiquidityRouter: invalid msg.value")

    await expect(liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, false]), { value: 3000 }))
      .to.be.revertedWith("LiquidityRouter: invalid msg.value")

    removeLiquidityParams[0] = dai.address
    await expect(liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, true]), { value: 4000 }))
      .to.be.revertedWith("LiquidityRouter: invalid _path")

    removeLiquidityParams[0] = bnb.address
    const tx2 = await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, false]), { value: 4000 })
    await reportGasUsed(provider, tx2, "createRemoveLiquidity gas used")

    blockNumber = await provider.getBlockNumber()
    blockTime = await getBlockTime(provider)

    key = await liquidityRouter.getRequestKey(user0.address, 1)
    request = await liquidityRouter.removeLiquidityRequests(key)

    expect(request.account).eq(user0.address)
    expect(request.tokenOut).eq(bnb.address)
    expect(request.flpAmount).eq(expandDecimals(590, 18))
    expect(request.minOut).eq(expandDecimals(1, 18))
    expect(request.receiver).eq(user0.address)
    expect(request.acceptablePrice).eq(toUsd(310))
    expect(request.blockNumber).eq(blockNumber)
    expect(request.blockTime).eq(blockTime)
    expect(request.isETHOut).eq(false)

    await liquidityRouter.setRequestKeeper(positionKeeper.address, false)

    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.removeLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await increaseTime(provider, 10)

    const tx3 = await liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address)
    await reportGasUsed(provider, tx3, "executeRemoveLiquidity gas used")

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    request = await liquidityRouter.removeLiquidityRequests(key)
    expect(request.account).eq(AddressZero)
    expect(request.tokenOut).eq(AddressZero)

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, true]), { value: 4000 })

    key = await liquidityRouter.getRequestKey(user0.address, 2)

    request = await liquidityRouter.removeLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await liquidityRouter.connect(positionKeeper).cancelRemoveLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.removeLiquidityRequests(key)
    expect(request.account).eq(user0.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await liquidityRouter.connect(positionKeeper).cancelRemoveLiquidity(key, executionFeeReceiver.address)

    request = await liquidityRouter.removeLiquidityRequests(key)
    expect(request.account).eq(AddressZero)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(12000)

    await liquidityRouter.connect(positionKeeper).cancelRemoveLiquidity(key, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(12000)

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([4000, false]), { value: 4000 })
    key = await liquidityRouter.getRequestKey(user0.address, 3)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(key, executionFeeReceiver.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")
  })

  it("executeAddLiquidities, executeRemoveLiquidities", async () => {
    await liquidityRouter.setDelayValues(5, 300, 500)
    const executionFeeReceiver = newWallet()

    await router.addPlugin(liquidityRouter.address)
    await router.connect(user0).approvePlugin(liquidityRouter.address)
    await router.connect(user1).approvePlugin(liquidityRouter.address)
    await router.connect(user2).approvePlugin(liquidityRouter.address)

    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidities(100, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(100, executionFeeReceiver.address))
      .to.be.revertedWith("BaseRequestRouter: forbidden")

    await liquidityRouter.setRequestKeeper(positionKeeper.address, true)

    let queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(0) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(100, executionFeeReceiver.address)
    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(100, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(0) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    let params = [
      bnb.address, // _token
      expandDecimals(2, 18), // _amountIn
      expandDecimals(590, 18), // _minUsdf
      expandDecimals(590, 18), // _minFlp
      toUsd(290), // _acceptablePrice
    ]

    const referralCode = "0x0000000000000000000000000000000000000000000000000000000000000123"

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    let key0 = await liquidityRouter.getRequestKey(user0.address, 1)
    let request0 = await liquidityRouter.addLiquidityRequests(key0)
    expect(request0.account).eq(user0.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(1) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user1).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    let key1 = await liquidityRouter.getRequestKey(user1.address, 1)
    let request1 = await liquidityRouter.addLiquidityRequests(key1)
    expect(request1.account).eq(user1.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(2) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await bnb.mint(user2.address, expandDecimals(2, 18))
    await bnb.connect(user2).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user2).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    let key2 = await liquidityRouter.getRequestKey(user2.address, 1)
    let request2 = await liquidityRouter.addLiquidityRequests(key2)
    expect(request2.account).eq(user2.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(3) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    params[3] = expandDecimals(610, 18) // _minFlp

    await router.connect(user3).approvePlugin(liquidityRouter.address)
    await bnb.mint(user3.address, expandDecimals(2, 18))
    await bnb.connect(user3).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user3).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    let key3 = await liquidityRouter.getRequestKey(user3.address, 1)
    let request3 = await liquidityRouter.addLiquidityRequests(key3)
    expect(request3.account).eq(user3.address)

    params[3] = expandDecimals(590, 18) // _sizeDelta

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(4) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await router.connect(user4).approvePlugin(liquidityRouter.address)
    await bnb.mint(user4.address, expandDecimals(2, 18))
    await bnb.connect(user4).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user4).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    let key4 = await liquidityRouter.getRequestKey(user4.address, 1)
    let request4 = await liquidityRouter.addLiquidityRequests(key4)
    expect(request4.account).eq(user4.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(5) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)

    await liquidityRouter.connect(positionKeeper).executeAddLiquidity(key2, executionFeeReceiver.address)
    expect(await provider.getBalance(executionFeeReceiver.address)).eq(4000)

    expect((await liquidityRouter.addLiquidityRequests(key2)).account).eq(AddressZero)

    await expect(liquidityRouter.connect(positionKeeper).executeAddLiquidity(key3, executionFeeReceiver.address))
      .to.be.revertedWith("FlpManager: insufficient FLP output")

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(0, executionFeeReceiver.address)
    expect((await liquidityRouter.addLiquidityRequests(key0)).account).eq(user0.address)
    expect((await liquidityRouter.addLiquidityRequests(key1)).account).eq(user1.address)
    expect((await liquidityRouter.addLiquidityRequests(key2)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key3)).account).eq(user3.address)
    expect((await liquidityRouter.addLiquidityRequests(key4)).account).eq(user4.address)

    expect(await liquidityRouter.addLiquidityRequestKeys(0)).eq(key0)
    expect(await liquidityRouter.addLiquidityRequestKeys(1)).eq(key1)
    expect(await liquidityRouter.addLiquidityRequestKeys(2)).eq(key2)
    expect(await liquidityRouter.addLiquidityRequestKeys(3)).eq(key3)
    expect(await liquidityRouter.addLiquidityRequestKeys(4)).eq(key4)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(0) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(5) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(1, executionFeeReceiver.address)
    expect((await liquidityRouter.addLiquidityRequests(key0)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key1)).account).eq(user1.address)
    expect((await liquidityRouter.addLiquidityRequests(key2)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key3)).account).eq(user3.address)
    expect((await liquidityRouter.addLiquidityRequests(key4)).account).eq(user4.address)

    expect(await liquidityRouter.addLiquidityRequestKeys(0)).eq(HashZero)
    expect(await liquidityRouter.addLiquidityRequestKeys(1)).eq(key1)
    expect(await liquidityRouter.addLiquidityRequestKeys(2)).eq(key2)
    expect(await liquidityRouter.addLiquidityRequestKeys(3)).eq(key3)
    expect(await liquidityRouter.addLiquidityRequestKeys(4)).eq(key4)

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(1) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(5) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(0, executionFeeReceiver.address)

    expect((await liquidityRouter.addLiquidityRequests(key0)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key1)).account).eq(user1.address)
    expect((await liquidityRouter.addLiquidityRequests(key2)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key3)).account).eq(user3.address)
    expect((await liquidityRouter.addLiquidityRequests(key4)).account).eq(user4.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(1) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(5) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(8000)

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(user2.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)
    expect(await bnb.balanceOf(user4.address)).eq(0)

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(10, executionFeeReceiver.address)

    expect((await liquidityRouter.addLiquidityRequests(key0)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key1)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key2)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key3)).account).eq(AddressZero)
    expect((await liquidityRouter.addLiquidityRequests(key4)).account).eq(AddressZero)

    expect(await liquidityRouter.addLiquidityRequestKeys(0)).eq(HashZero)
    expect(await liquidityRouter.addLiquidityRequestKeys(1)).eq(HashZero)
    expect(await liquidityRouter.addLiquidityRequestKeys(2)).eq(HashZero)
    expect(await liquidityRouter.addLiquidityRequestKeys(3)).eq(HashZero)
    expect(await liquidityRouter.addLiquidityRequestKeys(4)).eq(HashZero)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(5) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    expect(await provider.getBalance(executionFeeReceiver.address)).eq(20000)

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(user2.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(expandDecimals(2, 18)) // refunded
    expect(await bnb.balanceOf(user4.address)).eq(0)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(2, 18))
    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(10, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(5) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await mineBlock(provider)

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(6, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(6) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(6, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(6) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeAddLiquidities(10, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(0) // removeLiquidityRequestKeys.length

    let removeLiquidityParams = [
      bnb.address, // _tokenOut
      expandDecimals(590, 18), // _flpAmount
      expandDecimals(1, 18), // _minOut
    ]

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(310), 4000, false]), { value: 4000 })
    let decreaseKey0 = await liquidityRouter.getRequestKey(user0.address, 1)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey0)).account).eq(user0.address)

    await liquidityRouter.connect(user1).createRemoveLiquidity(...removeLiquidityParams.concat([user1.address, toUsd(310), 4000, false]), { value: 4000 })
    let decreaseKey1 = await liquidityRouter.getRequestKey(user1.address, 1)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey1)).account).eq(user1.address)

    await liquidityRouter.connect(user2).createRemoveLiquidity(...removeLiquidityParams.concat([user2.address, toUsd(310), 4000, false]), { value: 4000 })
    let decreaseKey2 = await liquidityRouter.getRequestKey(user2.address, 1)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey2)).account).eq(user2.address)

    await liquidityRouter.connect(user3).createRemoveLiquidity(...removeLiquidityParams.concat([user3.address, toUsd(310), 4000, false]), { value: 4000 })
    let decreaseKey3 = await liquidityRouter.getRequestKey(user3.address, 1)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey3)).account).eq(user3.address)

    await liquidityRouter.connect(user4).createRemoveLiquidity(...removeLiquidityParams.concat([user4.address, toUsd(310), 4000, false]), { value: 4000 })
    let decreaseKey4 = await liquidityRouter.getRequestKey(user4.address, 1)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey4)).account).eq(user4.address)

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(user2.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(expandDecimals(2, 18))
    expect(await bnb.balanceOf(user4.address)).eq(0)

    await expect(liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(decreaseKey3, executionFeeReceiver.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidity(decreaseKey2, executionFeeReceiver.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey2)).account).eq(AddressZero)

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await bnb.balanceOf(user2.address)).gt("1900000000000000000")
    expect(await bnb.balanceOf(user3.address)).eq(expandDecimals(2, 18))
    expect(await bnb.balanceOf(user4.address)).eq(0)

    // queue: request0, request1, request2 (executed), request3 (not executable), request4

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(0, executionFeeReceiver.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey0)).account).eq(user0.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey1)).account).eq(user1.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey2)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey3)).account).eq(user3.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey4)).account).eq(user4.address)

    expect(await liquidityRouter.removeLiquidityRequestKeys(0)).eq(decreaseKey0)
    expect(await liquidityRouter.removeLiquidityRequestKeys(1)).eq(decreaseKey1)
    expect(await liquidityRouter.removeLiquidityRequestKeys(2)).eq(decreaseKey2)
    expect(await liquidityRouter.removeLiquidityRequestKeys(3)).eq(decreaseKey3)
    expect(await liquidityRouter.removeLiquidityRequestKeys(4)).eq(decreaseKey4)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(0) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(5) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(1, executionFeeReceiver.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey0)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey1)).account).eq(user1.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey2)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey3)).account).eq(user3.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey4)).account).eq(user4.address)

    expect(await liquidityRouter.removeLiquidityRequestKeys(0)).eq(HashZero)
    expect(await liquidityRouter.removeLiquidityRequestKeys(1)).eq(decreaseKey1)
    expect(await liquidityRouter.removeLiquidityRequestKeys(2)).eq(decreaseKey2)
    expect(await liquidityRouter.removeLiquidityRequestKeys(3)).eq(decreaseKey3)
    expect(await liquidityRouter.removeLiquidityRequestKeys(4)).eq(decreaseKey4)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(1) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(5) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(10, executionFeeReceiver.address)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey0)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey1)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey2)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey3)).account).eq(AddressZero)
    expect((await liquidityRouter.removeLiquidityRequests(decreaseKey4)).account).eq(AddressZero)

    expect(await liquidityRouter.removeLiquidityRequestKeys(0)).eq(HashZero)
    expect(await liquidityRouter.removeLiquidityRequestKeys(1)).eq(HashZero)
    expect(await liquidityRouter.removeLiquidityRequestKeys(2)).eq(HashZero)
    expect(await liquidityRouter.removeLiquidityRequestKeys(3)).eq(HashZero)
    expect(await liquidityRouter.removeLiquidityRequestKeys(4)).eq(HashZero)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(5) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(5) // removeLiquidityRequestKeys.length

    expect(await bnb.balanceOf(user0.address)).gt("1900000000000000000")
    expect(await bnb.balanceOf(user1.address)).gt("1900000000000000000")
    expect(await bnb.balanceOf(user2.address)).gt("1900000000000000000")
    expect(await bnb.balanceOf(user3.address)).eq(expandDecimals(2, 18))
    expect(await bnb.balanceOf(user4.address)).gt("1900000000000000000")

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(310), 4000, false]), { value: 4000 })
    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(310), 4000, false]), { value: 4000 })

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(5) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(7) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(10, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(5) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(7) // removeLiquidityRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(6, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(6) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(7) // removeLiquidityRequestKeys.length

    await mineBlock(provider)
    await mineBlock(provider)
    await mineBlock(provider)

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(6, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(6) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(7) // removeLiquidityRequestKeys.length

    await liquidityRouter.connect(positionKeeper).executeRemoveLiquidities(10, executionFeeReceiver.address)

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(7) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(7) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(7) // removeLiquidityRequestKeys.length

    await bnb.mint(user0.address, expandDecimals(6, 18))
    await bnb.connect(user0).approve(router.address, expandDecimals(6, 18))

    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })
    await liquidityRouter.connect(user0).createAddLiquidity(...params.concat([4000, referralCode]), { value: 4000 })

    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(290), 4000, false]), { value: 4000 })
    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(290), 4000, false]), { value: 4000 })
    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(290), 4000, false]), { value: 4000 })
    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(290), 4000, false]), { value: 4000 })
    await liquidityRouter.connect(user0).createRemoveLiquidity(...removeLiquidityParams.concat([user0.address, toUsd(290), 4000, false]), { value: 4000 })

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(7) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(10) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(7) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(12) // removeLiquidityRequestKeys.length

    await fastPriceFeed.setMaxTimeDeviation(1000)
    await positionRouter.setPositionKeeper(fastPriceFeed.address, true)
    await swapRouter.setRequestKeeper(fastPriceFeed.address, true)
    await liquidityRouter.setRequestKeeper(fastPriceFeed.address, true)

    const blockTime = await getBlockTime(provider)

    await expect(fastPriceFeed.connect(user0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      0, // _endIndexForIncreasePositions
      0, // _endIndexForRemoveDecreasePositions
      0, // _endIndexForSwaps
      9, // _endIndexForAddLiquidities
      10 // _endIndexForRemoeLiquidities
    )).to.be.revertedWith("FastPriceFeed: forbidden")

    await fastPriceFeed.connect(updater0).setPricesWithBitsAndExecute(
      0, // _priceBits
      blockTime, // _timestamp
      0, // _endIndexForIncreasePositions
      0, // _endIndexForDecreasePositions
      0, // _endIndexForSwaps
      9, // _endIndexForAddLiquidities
      10 // _endIndexForRemoeLiquidities
    )

    queueLengths = await liquidityRouter.getRequestQueueLengths()
    expect(queueLengths[0]).eq(9) // addLiquidityRequestKeysStart
    expect(queueLengths[1]).eq(10) // addLiquidityRequestKeys.length
    expect(queueLengths[2]).eq(10) // removeLiquidityRequestKeysStart
    expect(queueLengths[3]).eq(12) // removeLiquidityRequestKeys.length
  })
})
