const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, getEthConfig } = require("../core/Vault/helpers")

use(solidity)

describe("RewardRouterV2", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, user4, tokenManager, liquidityRouter] = provider.getWallets()

  const vestingDuration = 365 * 24 * 60 * 60

  let timelock

  let vault
  let flpManager
  let flp
  let usdf
  let router
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed

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

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    flp = await deployContract("FLP", [])

    const { feeUtils } = await initVault(vault, router, usdf, vaultPriceFeed)
    flpManager = await deployContract("FlpManager", [vault.address, usdf.address, flp.address, 24 * 60 * 60])

    timelock = await deployContract("Timelock", [
      wallet.address,
      10,
      tokenManager.address,
      tokenManager.address,
      flpManager.address,
      expandDecimals(1000000, 18)
    ])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000))
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

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

    await vault.setGov(timelock.address)
    await feeUtils.setGov(timelock.address)
    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true)
  })

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true)

    expect(await rewardRouter.weth()).eq(bnb.address)
    expect(await rewardRouter.fxdx()).eq(fxdx.address)
    expect(await rewardRouter.esFxdx()).eq(esFxdx.address)
    expect(await rewardRouter.bnFxdx()).eq(bnFxdx.address)

    expect(await rewardRouter.flp()).eq(flp.address)

    expect(await rewardRouter.stakedFxdxTracker()).eq(stakedFxdxTracker.address)
    expect(await rewardRouter.bonusFxdxTracker()).eq(bonusFxdxTracker.address)
    expect(await rewardRouter.feeFxdxTracker()).eq(feeFxdxTracker.address)

    expect(await rewardRouter.feeFlpTracker()).eq(feeFlpTracker.address)
    expect(await rewardRouter.stakedFlpTracker()).eq(stakedFlpTracker.address)

    expect(await rewardRouter.flpManager()).eq(flpManager.address)

    expect(await rewardRouter.fxdxVester()).eq(fxdxVester.address)
    expect(await rewardRouter.flpVester()).eq(flpVester.address)

    await expect(rewardRouter.initialize(
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
    )).to.be.revertedWith("RewardRouter: already initialized")
  })

  it("setLiquidityRouter", async () => {
    expect(await rewardRouter.isLiquidityRouter(liquidityRouter.address)).eq(true)

    await expect(rewardRouter.connect(user0).setLiquidityRouter(
      liquidityRouter.address,
      false
    )).to.be.revertedWith("Governable: forbidden")

    expect(await rewardRouter.isLiquidityRouter(liquidityRouter.address)).eq(true);

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, false);
    expect(await rewardRouter.isLiquidityRouter(liquidityRouter.address)).eq(false);

    await rewardRouter.setLiquidityRouter(liquidityRouter.address, true);
    expect(await rewardRouter.isLiquidityRouter(liquidityRouter.address)).eq(true);

  })

  it("stakeFxdxForAccount, stakeFxdx, stakeEsFxdx, unstakeFxdx, unstakeEsFxdx, claimEsFxdx, claimFees, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeFxdxDistributor.address, expandDecimals(100, 18))
    await feeFxdxDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(user0.address, expandDecimals(1500, 18))
    expect(await fxdx.balanceOf(user0.address)).eq(expandDecimals(1500, 18))

    await fxdx.connect(user0).approve(stakedFxdxTracker.address, expandDecimals(1000, 18))
    await expect(rewardRouter.connect(user0).stakeFxdxForAccount(user1.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Governable: forbidden")

    await rewardRouter.setGov(user0.address)
    await rewardRouter.connect(user0).stakeFxdxForAccount(user1.address, expandDecimals(800, 18))
    expect(await fxdx.balanceOf(user0.address)).eq(expandDecimals(700, 18))

    await fxdx.mint(user1.address, expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await fxdx.connect(user1).approve(stakedFxdxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeFxdx(expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)

    expect(await stakedFxdxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user0.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(1000, 18))

    expect(await bonusFxdxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusFxdxTracker.depositBalances(user0.address, stakedFxdxTracker.address)).eq(0)
    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusFxdxTracker.depositBalances(user1.address, stakedFxdxTracker.address)).eq(expandDecimals(1000, 18))

    expect(await feeFxdxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user0.address, bonusFxdxTracker.address)).eq(0)
    expect(await feeFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).eq(expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedFxdxTracker.claimable(user0.address)).eq(0)
    expect(await stakedFxdxTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedFxdxTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    expect(await bonusFxdxTracker.claimable(user0.address)).eq(0)
    expect(await bonusFxdxTracker.claimable(user1.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusFxdxTracker.claimable(user1.address)).lt("2750000000000000000") // 2.75

    expect(await feeFxdxTracker.claimable(user0.address)).eq(0)
    expect(await feeFxdxTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeFxdxTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    await timelock.signalMint(esFxdx.address, tokenManager.address, expandDecimals(500, 18))
    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.processMint(esFxdx.address, tokenManager.address, expandDecimals(500, 18))
    await esFxdx.connect(tokenManager).transferFrom(tokenManager.address, user2.address, expandDecimals(500, 18))
    await rewardRouter.connect(user2).stakeEsFxdx(expandDecimals(500, 18))

    expect(await stakedFxdxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user0.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(1000, 18))
    expect(await stakedFxdxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await stakedFxdxTracker.depositBalances(user2.address, esFxdx.address)).eq(expandDecimals(500, 18))

    expect(await bonusFxdxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusFxdxTracker.depositBalances(user0.address, stakedFxdxTracker.address)).eq(0)
    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusFxdxTracker.depositBalances(user1.address, stakedFxdxTracker.address)).eq(expandDecimals(1000, 18))
    expect(await bonusFxdxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await bonusFxdxTracker.depositBalances(user2.address, stakedFxdxTracker.address)).eq(expandDecimals(500, 18))

    expect(await feeFxdxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user0.address, bonusFxdxTracker.address)).eq(0)
    expect(await feeFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).eq(expandDecimals(1000, 18))
    expect(await feeFxdxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await feeFxdxTracker.depositBalances(user2.address, bonusFxdxTracker.address)).eq(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedFxdxTracker.claimable(user0.address)).eq(0)
    expect(await stakedFxdxTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedFxdxTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedFxdxTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedFxdxTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await bonusFxdxTracker.claimable(user0.address)).eq(0)
    expect(await bonusFxdxTracker.claimable(user1.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusFxdxTracker.claimable(user1.address)).lt("5490000000000000000")
    expect(await bonusFxdxTracker.claimable(user2.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusFxdxTracker.claimable(user2.address)).lt("1380000000000000000")

    expect(await feeFxdxTracker.claimable(user0.address)).eq(0)
    expect(await feeFxdxTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeFxdxTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeFxdxTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeFxdxTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await esFxdx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsFxdx()
    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esFxdx.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsFxdx()
    expect(await esFxdx.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esFxdx.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx0 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx0, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx1 = await rewardRouter.connect(user0).batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(1000, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(2643, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(2645, 18))

    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))

    expect(await feeFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3657, 18))
    expect(await feeFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3659, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).gt(expandDecimals(3643, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).lt(expandDecimals(3645, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("14100000000000000000") // 14.1
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("14300000000000000000") // 14.3

    expect(await fxdx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).unstakeFxdx(expandDecimals(300, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(300, 18))

    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(700, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(2643, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(2645, 18))

    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))

    expect(await feeFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3357, 18))
    expect(await feeFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3359, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).gt(expandDecimals(3343, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).lt(expandDecimals(3345, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("13000000000000000000") // 13
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("13100000000000000000") // 13.1

    const esFxdxBalance1 = await esFxdx.balanceOf(user1.address)
    const esFxdxUnstakeBalance1 = await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)
    await rewardRouter.connect(user1).unstakeEsFxdx(esFxdxUnstakeBalance1)
    expect(await esFxdx.balanceOf(user1.address)).eq(esFxdxBalance1.add(esFxdxUnstakeBalance1))

    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(700, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).eq(0)

    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))

    expect(await feeFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(702, 18))
    expect(await feeFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(703, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).eq(expandDecimals(700, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("2720000000000000000") // 2.72
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("2740000000000000000") // 2.74

    await expect(rewardRouter.connect(user1).unstakeEsFxdx(expandDecimals(1, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance")
  })

  it("mintAndStakeFlpForAccount, unstakeAndRedeemFlpForAccount, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeFlpDistributor.address, expandDecimals(100, 18))
    await feeFlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))
    await expect(rewardRouter.connect(user1).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )).to.be.revertedWith("RewardRouter: forbidden")

    const tx0 = await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    await reportGasUsed(provider, tx0, "mintAndStakeFlpForAccount gas used")

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(2, 18))
    await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(2, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    expect(await feeFlpTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeFlpTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    expect(await stakedFlpTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedFlpTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(flpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user2.address,
      user2.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await expect(rewardRouter.connect(user2).unstakeAndRedeemFlpForAccount(
      user2.address,
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user2.address
    )).to.be.revertedWith("RewardRouter: forbidden")

    await expect(rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user2.address,
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user2.address
    )).to.be.revertedWith("FlpManager: cooldown duration not yet passed")

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq("897300000000000000000") // 897.3
    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq("897300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq(0)

    const tx1 = await rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user1.address,
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address
    )
    await reportGasUsed(provider, tx1, "unstakeAndRedeemFlpForAccount gas used")

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeFlpTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeFlpTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeFlpTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeFlpTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await stakedFlpTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedFlpTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedFlpTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedFlpTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await esFxdx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsFxdx()
    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esFxdx.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsFxdx()
    expect(await esFxdx.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esFxdx.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx2 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx2, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx3 = await rewardRouter.batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await stakedFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(4165, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(4167, 18))

    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await bonusFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))

    expect(await feeFxdxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4179, 18))
    expect(await feeFxdxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4180, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).gt(expandDecimals(4165, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bonusFxdxTracker.address)).lt(expandDecimals(4167, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("12900000000000000000") // 12.9
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("13100000000000000000") // 13.1

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99
  })

  it("fxdx: signalTransfer, acceptTransfer", async () =>{
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(user1.address, expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await fxdx.connect(user1).approve(stakedFxdxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeFxdx(expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)

    await fxdx.mint(user2.address, expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await fxdx.connect(user2).approve(stakedFxdxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeFxdx(expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).claim()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedFxdxTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await fxdxVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedFxdxTracker.depositBalances(user2.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user2.address, esFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user2.address, bnFxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).eq(0)
    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.bonusRewards(user3.address)).eq(0)
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedFxdxTracker.depositBalances(user2.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user2.address, esFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user2.address, bnFxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).gt(expandDecimals(892, 18))
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).lt(expandDecimals(893, 18))
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).gt("547000000000000000") // 0.547
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).lt("549000000000000000") // 0.548
    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await fxdxVester.bonusRewards(user2.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await fxdx.connect(user3).approve(stakedFxdxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user3).signalTransfer(user4.address)
    await rewardRouter.connect(user4).acceptTransfer(user3.address)

    expect(await stakedFxdxTracker.depositBalances(user3.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user4.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user4.address, esFxdx.address)).gt(expandDecimals(892, 18))
    expect(await stakedFxdxTracker.depositBalances(user4.address, esFxdx.address)).lt(expandDecimals(893, 18))
    expect(await feeFxdxTracker.depositBalances(user4.address, bnFxdx.address)).gt("547000000000000000") // 0.547
    expect(await feeFxdxTracker.depositBalances(user4.address, bnFxdx.address)).lt("549000000000000000") // 0.548
    expect(await fxdxVester.transferredAverageStakedAmounts(user4.address)).gt(expandDecimals(200, 18))
    expect(await fxdxVester.transferredAverageStakedAmounts(user4.address)).lt(expandDecimals(201, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user4.address)).gt(expandDecimals(892, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user4.address)).lt(expandDecimals(894, 18))
    expect(await fxdxVester.bonusRewards(user3.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user4.address)).eq(expandDecimals(100, 18))
    expect(await stakedFxdxTracker.averageStakedAmounts(user3.address)).gt(expandDecimals(1092, 18))
    expect(await stakedFxdxTracker.averageStakedAmounts(user3.address)).lt(expandDecimals(1094, 18))
    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user4.address)).gt(expandDecimals(200, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user4.address)).lt(expandDecimals(201, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user4.address)).gt(expandDecimals(992, 18))
    expect(await fxdxVester.getMaxVestableAmount(user4.address)).lt(expandDecimals(993, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user4.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await fxdxVester.getPairAmount(user4.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await expect(rewardRouter.connect(user4).acceptTransfer(user3.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")
  })

  it("fxdx, flp: signalTransfer, acceptTransfer", async () =>{
    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(fxdxVester.address, expandDecimals(10000, 18))
    await fxdx.mint(flpVester.address, expandDecimals(10000, 18))
    await eth.mint(feeFlpDistributor.address, expandDecimals(100, 18))
    await feeFlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(flpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user2.address,
      user2.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await fxdx.mint(user1.address, expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await fxdx.connect(user1).approve(stakedFxdxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeFxdx(expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)

    await fxdx.mint(user2.address, expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await fxdx.connect(user2).approve(stakedFxdxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeFxdx(expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedFxdxTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await fxdxVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedFxdxTracker.depositBalances(user2.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user2.address, esFxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).eq(0)

    expect(await feeFxdxTracker.depositBalances(user2.address, bnFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).eq(0)

    expect(await feeFlpTracker.depositBalances(user2.address, flp.address)).eq("299100000000000000000") // 299.1
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(0)

    expect(await stakedFlpTracker.depositBalances(user2.address, feeFlpTracker.address)).eq("299100000000000000000") // 299.1
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(0)

    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.bonusRewards(user3.address)).eq(0)
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedFxdxTracker.depositBalances(user2.address, fxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user2.address, esFxdx.address)).eq(0)
    expect(await stakedFxdxTracker.depositBalances(user3.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).gt(expandDecimals(1785, 18))
    expect(await stakedFxdxTracker.depositBalances(user3.address, esFxdx.address)).lt(expandDecimals(1786, 18))

    expect(await feeFxdxTracker.depositBalances(user2.address, bnFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).gt("547000000000000000") // 0.547
    expect(await feeFxdxTracker.depositBalances(user3.address, bnFxdx.address)).lt("549000000000000000") // 0.548

    expect(await feeFlpTracker.depositBalances(user2.address, flp.address)).eq(0)
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq("299100000000000000000") // 299.1

    expect(await stakedFlpTracker.depositBalances(user2.address, feeFlpTracker.address)).eq(0)
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq("299100000000000000000") // 299.1

    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await fxdxVester.bonusRewards(user2.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))
    expect(await fxdxVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(199, 18))
    expect(await fxdxVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(200, 18))

    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user1).claim()
    await rewardRouter.connect(user2).claim()
    await rewardRouter.connect(user3).claim()

    expect(await fxdxVester.getCombinedAverageStakedAmount(user1.address)).gt(expandDecimals(1092, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user1.address)).lt(expandDecimals(1094, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))

    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1885, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1887, 18))
    expect(await fxdxVester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1785, 18))
    expect(await fxdxVester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1787, 18))

    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(1885, 18))).gt(expandDecimals(1092, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(1885, 18))).lt(expandDecimals(1094, 18))
    expect(await fxdxVester.getPairAmount(user1.address, expandDecimals(1785, 18))).gt(expandDecimals(1092, 18))
    expect(await fxdxVester.getPairAmount(user1.address, expandDecimals(1785, 18))).lt(expandDecimals(1094, 18))

    await rewardRouter.connect(user1).compound()
    await rewardRouter.connect(user3).compound()

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(1992, 18))
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(1993, 18))

    await fxdxVester.connect(user1).deposit(expandDecimals(1785, 18))

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(1991 - 1092, 18)) // 899
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(1993 - 1092, 18)) // 901

    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt(expandDecimals(4, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt(expandDecimals(6, 18))

    await rewardRouter.connect(user1).unstakeFxdx(expandDecimals(200, 18))
    await expect(rewardRouter.connect(user1).unstakeEsFxdx(expandDecimals(699, 18)))
      .to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await rewardRouter.connect(user1).unstakeEsFxdx(expandDecimals(599, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(97, 18))
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(99, 18))

    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(599, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(601, 18))

    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(200, 18))

    await fxdxVester.connect(user1).withdraw()

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18)) // 1190 - 98 => 1092
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(2378, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(2380, 18))

    expect(await fxdx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await fxdx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    expect(await flpVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1785, 18))
    expect(await flpVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1787, 18))

    expect(await flpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).gt(expandDecimals(298, 18))
    expect(await flpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).lt(expandDecimals(300, 18))

    expect(await stakedFlpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esFxdx.balanceOf(user3.address)).gt(expandDecimals(1785, 18))
    expect(await esFxdx.balanceOf(user3.address)).lt(expandDecimals(1787, 18))

    expect(await fxdx.balanceOf(user3.address)).eq(0)

    await flpVester.connect(user3).deposit(expandDecimals(1785, 18))

    expect(await stakedFlpTracker.balanceOf(user3.address)).gt(0)
    expect(await stakedFlpTracker.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await esFxdx.balanceOf(user3.address)).gt(0)
    expect(await esFxdx.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await fxdx.balanceOf(user3.address)).eq(0)

    await expect(rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user3.address,
      bnb.address,
      expandDecimals(1, 18),
      0,
      user3.address
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await flpVester.connect(user3).withdraw()

    expect(await stakedFlpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esFxdx.balanceOf(user3.address)).gt(expandDecimals(1785 - 5, 18))
    expect(await esFxdx.balanceOf(user3.address)).lt(expandDecimals(1787 - 5, 18))

    expect(await fxdx.balanceOf(user3.address)).gt(expandDecimals(4, 18))
    expect(await fxdx.balanceOf(user3.address)).lt(expandDecimals(6, 18))

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(2379, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(2381, 18))

    expect(await fxdx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await fxdx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await fxdxVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(743, 18)) // 1190 - 743 => 447
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(754, 18))

    expect(await fxdxVester.claimable(user1.address)).eq(0)

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await fxdxVester.claimable(user1.address)).gt("3900000000000000000") // 3.9
    expect(await fxdxVester.claimable(user1.address)).lt("4100000000000000000") // 4.1

    await fxdxVester.connect(user1).deposit(expandDecimals(365, 18))

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(522, 18)) // 743 - 522 => 221
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(524, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await fxdxVester.claimable(user1.address)).gt("9900000000000000000") // 9.9
    expect(await fxdxVester.claimable(user1.address)).lt("10100000000000000000") // 10.1

    expect(await fxdx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await fxdx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await fxdxVester.connect(user1).claim()

    expect(await fxdx.balanceOf(user1.address)).gt(expandDecimals(214, 18))
    expect(await fxdx.balanceOf(user1.address)).lt(expandDecimals(216, 18))

    await fxdxVester.connect(user1).deposit(expandDecimals(365, 18))
    expect(await fxdxVester.balanceOf(user1.address)).gt(expandDecimals(1449, 18)) // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await fxdxVester.balanceOf(user1.address)).lt(expandDecimals(1451, 18))
    expect(await fxdxVester.getVestedAmount(user1.address)).eq(expandDecimals(1460, 18))

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(303, 18)) // 522 - 303 => 219
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(304, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await fxdxVester.claimable(user1.address)).gt("7900000000000000000") // 7.9
    expect(await fxdxVester.claimable(user1.address)).lt("8100000000000000000") // 8.1

    await fxdxVester.connect(user1).withdraw()

    expect(await feeFxdxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeFxdxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await fxdx.balanceOf(user1.address)).gt(expandDecimals(222, 18))
    expect(await fxdx.balanceOf(user1.address)).lt(expandDecimals(224, 18))

    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(2360, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(2362, 18))

    await fxdxVester.connect(user1).deposit(expandDecimals(365, 18))

    await increaseTime(provider, 500 * 24 * 60 * 60)
    await mineBlock(provider)

    expect(await fxdxVester.claimable(user1.address)).eq(expandDecimals(365, 18))

    await fxdxVester.connect(user1).withdraw()

    expect(await fxdx.balanceOf(user1.address)).gt(expandDecimals(222 + 365, 18))
    expect(await fxdx.balanceOf(user1.address)).lt(expandDecimals(224 + 365, 18))

    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(2360 - 365, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(2362 - 365, 18))

    expect(await fxdxVester.transferredAverageStakedAmounts(user2.address)).eq(0)
    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.cumulativeRewards(user2.address)).gt(expandDecimals(892, 18))
    expect(await stakedFxdxTracker.cumulativeRewards(user2.address)).lt(expandDecimals(893, 18))
    expect(await stakedFxdxTracker.cumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await stakedFxdxTracker.cumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await fxdxVester.bonusRewards(user2.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1093, 18))
    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886, 18))
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(574, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(575, 18))
    expect(await fxdxVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(545, 18))
    expect(await fxdxVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(546, 18))

    const esFxdxBatchSender = await deployContract("EsFxdxBatchSender", [esFxdx.address])

    await timelock.signalSetHandler(esFxdx.address, esFxdxBatchSender.address, true)
    await timelock.signalSetHandler(fxdxVester.address, esFxdxBatchSender.address, true)
    await timelock.signalSetHandler(flpVester.address, esFxdxBatchSender.address, true)
    await timelock.signalMint(esFxdx.address, wallet.address, expandDecimals(1000, 18))

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setHandler(esFxdx.address, esFxdxBatchSender.address, true)
    await timelock.setHandler(fxdxVester.address, esFxdxBatchSender.address, true)
    await timelock.setHandler(flpVester.address, esFxdxBatchSender.address, true)
    await timelock.processMint(esFxdx.address, wallet.address, expandDecimals(1000, 18))

    await esFxdxBatchSender.connect(wallet).send(
      fxdxVester.address,
      4,
      [user2.address, user3.address],
      [expandDecimals(100, 18), expandDecimals(200, 18)]
    )

    expect(await fxdxVester.transferredAverageStakedAmounts(user2.address)).gt(expandDecimals(37648, 18))
    expect(await fxdxVester.transferredAverageStakedAmounts(user2.address)).lt(expandDecimals(37649, 18))
    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).gt(expandDecimals(12810, 18))
    expect(await fxdxVester.transferredAverageStakedAmounts(user3.address)).lt(expandDecimals(12811, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892 + 200, 18))
    expect(await fxdxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893 + 200, 18))
    expect(await fxdxVester.bonusRewards(user2.address)).eq(0)
    expect(await fxdxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).gt(expandDecimals(3971, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user2.address)).lt(expandDecimals(3972, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(7943, 18))
    expect(await fxdxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(7944, 18))
    expect(await fxdxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884 + 200, 18))
    expect(await fxdxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886 + 200, 18))
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(100, 18))).gt(expandDecimals(3971, 18))
    expect(await fxdxVester.getPairAmount(user2.address, expandDecimals(100, 18))).lt(expandDecimals(3972, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).gt(expandDecimals(7936, 18))
    expect(await fxdxVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).lt(expandDecimals(7937, 18))

    expect(await flpVester.transferredAverageStakedAmounts(user4.address)).eq(0)
    expect(await flpVester.transferredCumulativeRewards(user4.address)).eq(0)
    expect(await flpVester.bonusRewards(user4.address)).eq(0)
    expect(await flpVester.getCombinedAverageStakedAmount(user4.address)).eq(0)
    expect(await flpVester.getMaxVestableAmount(user4.address)).eq(0)
    expect(await flpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(0)

    await esFxdxBatchSender.connect(wallet).send(
      flpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await flpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(3200, 18))
    expect(await flpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(10, 18))
    expect(await flpVester.bonusRewards(user4.address)).eq(0)
    expect(await flpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(3200, 18))
    expect(await flpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(10, 18))
    expect(await flpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))

    await esFxdxBatchSender.connect(wallet).send(
      flpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await flpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(6400, 18))
    expect(await flpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(20, 18))
    expect(await flpVester.bonusRewards(user4.address)).eq(0)
    expect(await flpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(6400, 18))
    expect(await flpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(20, 18))
    expect(await flpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))
  })

  it("handleRewards", async () => {
    const timelockV2 = wallet

    // use new rewardRouter, use eth for weth
    const rewardRouterV2 = await deployContract("RewardRouterV2", [])
    await rewardRouterV2.initialize(
      vault.address,
      eth.address,
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

    await timelock.setContractHandler(rewardRouterV2.address, true)
    await rewardRouterV2.setLiquidityRouter(liquidityRouter.address, true)

    await timelock.signalSetGov(flpManager.address, timelockV2.address)
    await timelock.signalSetGov(stakedFxdxTracker.address, timelockV2.address)
    await timelock.signalSetGov(bonusFxdxTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeFxdxTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeFlpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedFlpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedFxdxDistributor.address, timelockV2.address)
    await timelock.signalSetGov(stakedFlpDistributor.address, timelockV2.address)
    await timelock.signalSetGov(esFxdx.address, timelockV2.address)
    await timelock.signalSetGov(bnFxdx.address, timelockV2.address)
    await timelock.signalSetGov(fxdxVester.address, timelockV2.address)
    await timelock.signalSetGov(flpVester.address, timelockV2.address)

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setGov(flpManager.address, timelockV2.address)
    await timelock.setGov(stakedFxdxTracker.address, timelockV2.address)
    await timelock.setGov(bonusFxdxTracker.address, timelockV2.address)
    await timelock.setGov(feeFxdxTracker.address, timelockV2.address)
    await timelock.setGov(feeFlpTracker.address, timelockV2.address)
    await timelock.setGov(stakedFlpTracker.address, timelockV2.address)
    await timelock.setGov(stakedFxdxDistributor.address, timelockV2.address)
    await timelock.setGov(stakedFlpDistributor.address, timelockV2.address)
    await timelock.setGov(esFxdx.address, timelockV2.address)
    await timelock.setGov(bnFxdx.address, timelockV2.address)
    await timelock.setGov(fxdxVester.address, timelockV2.address)
    await timelock.setGov(flpVester.address, timelockV2.address)

    await esFxdx.setHandler(rewardRouterV2.address, true)
    await esFxdx.setHandler(stakedFxdxDistributor.address, true)
    await esFxdx.setHandler(stakedFlpDistributor.address, true)
    await esFxdx.setHandler(stakedFxdxTracker.address, true)
    await esFxdx.setHandler(stakedFlpTracker.address, true)
    await esFxdx.setHandler(fxdxVester.address, true)
    await esFxdx.setHandler(flpVester.address, true)

    await flpManager.setHandler(rewardRouterV2.address, true)
    await stakedFxdxTracker.setHandler(rewardRouterV2.address, true)
    await bonusFxdxTracker.setHandler(rewardRouterV2.address, true)
    await feeFxdxTracker.setHandler(rewardRouterV2.address, true)
    await feeFlpTracker.setHandler(rewardRouterV2.address, true)
    await stakedFlpTracker.setHandler(rewardRouterV2.address, true)

    await esFxdx.setHandler(rewardRouterV2.address, true)
    await bnFxdx.setMinter(rewardRouterV2.address, true)
    await esFxdx.setMinter(fxdxVester.address, true)
    await esFxdx.setMinter(flpVester.address, true)

    await fxdxVester.setHandler(rewardRouterV2.address, true)
    await flpVester.setHandler(rewardRouterV2.address, true)

    await feeFxdxTracker.setHandler(fxdxVester.address, true)
    await stakedFlpTracker.setHandler(flpVester.address, true)

    await eth.deposit({ value: expandDecimals(10, 18) })

    await fxdx.setMinter(wallet.address, true)
    await fxdx.mint(fxdxVester.address, expandDecimals(10000, 18))
    await fxdx.mint(flpVester.address, expandDecimals(10000, 18))

    await eth.mint(feeFlpDistributor.address, expandDecimals(50, 18))
    await feeFlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await eth.mint(feeFxdxDistributor.address, expandDecimals(50, 18))
    await feeFxdxDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))
    await rewardRouterV2.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await fxdx.mint(user1.address, expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await fxdx.connect(user1).approve(stakedFxdxTracker.address, expandDecimals(200, 18))
    await rewardRouterV2.connect(user1).stakeFxdx(expandDecimals(200, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await fxdx.balanceOf(user1.address)).eq(0)
    expect(await esFxdx.balanceOf(user1.address)).eq(0)
    expect(await bnFxdx.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).eq(0)

    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).eq(0)
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).eq(0)

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimFxdx
      true, // _shouldStakeFxdx
      true, // _shouldClaimEsFxdx
      true, // _shouldStakeEsFxdx
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimFees
      [eth.address], // _path
      0, // _minOut
      false // _shouldConvertFeesToEth
    )

    expect(await fxdx.balanceOf(user1.address)).eq(0)
    expect(await esFxdx.balanceOf(user1.address)).eq(0)
    expect(await bnFxdx.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(3572, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("540000000000000000") // 0.54
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const ethBalance0 = await provider.getBalance(user1.address)

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimFxdx
      false, // _shouldStakeFxdx
      false, // _shouldClaimEsFxdx
      false, // _shouldStakeEsFxdx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimFees
      [eth.address], // _path
      0, // _minOut
      true // _shouldConvertFeesToEth
    )

    const ethBalance1 = await provider.getBalance(user1.address)

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)
    expect(await esFxdx.balanceOf(user1.address)).eq(0)
    expect(await bnFxdx.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(3572, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("540000000000000000") // 0.54
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("560000000000000000") // 0.56

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimFxdx
      false, // _shouldStakeFxdx
      true, // _shouldClaimEsFxdx
      false, // _shouldStakeEsFxdx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimFees
      [], // _path
      0, // _minOut
      false // _shouldConvertFeesToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)
    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(3571, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(3572, 18))
    expect(await bnFxdx.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(3572, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("540000000000000000") // 0.54
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("560000000000000000") // 0.56

    await fxdxVester.connect(user1).deposit(expandDecimals(365, 18))
    await flpVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await fxdx.balanceOf(user1.address)).eq(0)
    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnFxdx.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(3572, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("540000000000000000") // 0.54
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await dai.mint(user0.address, expandDecimals(20000000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(2000000, 18))
    await vault.directPoolDeposit(dai.address);

    await expect(rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimFxdx
      false, // _shouldStakeFxdx
      false, // _shouldClaimEsFxdx
      false, // _shouldStakeEsFxdx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimFees
      [eth.address, dai.address], // _path
      expandDecimals(24000, 18), // _minOut
      false // _shouldConvertFeesToEth
    )).to.be.revertedWith("RewardRouterV2: insufficient amountOut")

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimFxdx
      false, // _shouldStakeFxdx
      false, // _shouldClaimEsFxdx
      false, // _shouldStakeEsFxdx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimFees
      [eth.address, dai.address], // _path
      expandDecimals(21000, 18), // _minOut
      false // _shouldConvertFeesToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await fxdx.balanceOf(user1.address)).gt("2900000000000000000") // 2.9
    expect(await fxdx.balanceOf(user1.address)).lt("3100000000000000000") // 3.1
    expect(await esFxdx.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esFxdx.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnFxdx.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))
    expect(await dai.balanceOf(user1.address)).gt(expandDecimals(21000, 18))
    expect(await dai.balanceOf(user1.address)).lt(expandDecimals(24000, 18))

    expect(await stakedFxdxTracker.depositBalances(user1.address, fxdx.address)).eq(expandDecimals(200, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedFxdxTracker.depositBalances(user1.address, esFxdx.address)).lt(expandDecimals(3572, 18))
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).gt("540000000000000000") // 0.54
    expect(await feeFxdxTracker.depositBalances(user1.address, bnFxdx.address)).lt("560000000000000000") // 0.56
  })

  it("StakedFlp", async () => {
    await eth.mint(feeFlpDistributor.address, expandDecimals(100, 18))
    await feeFlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))

    const stakedFlp = await deployContract("StakedFlp", [flp.address, flpManager.address, stakedFlpTracker.address, feeFlpTracker.address])

    await expect(stakedFlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedFlp: transfer amount exceeds allowance")

    await stakedFlp.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(stakedFlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedFlp: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(stakedFlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(stakedFlpTracker.address, stakedFlp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedFlpTracker.address, stakedFlp.address, true)

    await expect(stakedFlp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(feeFlpTracker.address, stakedFlp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(feeFlpTracker.address, stakedFlp.address, true)

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))

    expect(await feeFlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(0)

    expect(await stakedFlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(0)

    await stakedFlp.connect(user2).transferFrom(user1.address, user3. address, expandDecimals(2991, 17))

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(0)

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(0)

    expect(await feeFlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))

    await expect(stakedFlp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("StakedFlp: transfer amount exceeds allowance")

    await stakedFlp.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(stakedFlp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await stakedFlp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(1000, 17))

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(1000, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(1000, 17))

    expect(await feeFlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(expandDecimals(1991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(expandDecimals(1991, 17))

    await stakedFlp.connect(user3).transfer(user1.address, expandDecimals(1500, 17))

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2500, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2500, 17))

    expect(await feeFlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(expandDecimals(491, 17))

    expect(await stakedFlpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(expandDecimals(491, 17))

    await expect(stakedFlp.connect(user3).transfer(user1.address, expandDecimals(492, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user1.address,
      bnb.address,
      expandDecimals(2500, 17),
      "830000000000000000", // 0.83
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("830833333333333333")

    await usdf.addVault(flpManager.address)

    expect(await bnb.balanceOf(user3.address)).eq("0")

    await rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user3.address,
      bnb.address,
      expandDecimals(491, 17),
      "160000000000000000", // 0.16
      user3.address
    )

    expect(await bnb.balanceOf(user3.address)).eq("163175666666666666")
  })

  it("FeeFlp", async () => {
    await eth.mint(feeFlpDistributor.address, expandDecimals(100, 18))
    await feeFlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(liquidityRouter).mintAndStakeFlpForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))

    const flpBalance = await deployContract("FlpBalance", [flpManager.address, stakedFlpTracker.address])

    await expect(flpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("FlpBalance: transfer amount exceeds allowance")

    await flpBalance.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(flpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("FlpBalance: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(flpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds allowance")

    await timelock.signalSetHandler(stakedFlpTracker.address, flpBalance.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedFlpTracker.address, flpBalance.address, true)

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.balanceOf(user1.address)).eq(expandDecimals(2991, 17))

    expect(await feeFlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(0)

    expect(await stakedFlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(0)
    expect(await stakedFlpTracker.balanceOf(user3.address)).eq(0)

    await flpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17))

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.balanceOf(user1.address)).eq(0)

    expect(await feeFlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeFlpTracker.depositBalances(user3.address, flp.address)).eq(0)

    expect(await stakedFlpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedFlpTracker.depositBalances(user3.address, feeFlpTracker.address)).eq(0)
    expect(await stakedFlpTracker.balanceOf(user3.address)).eq(expandDecimals(2991, 17))

    await expect(rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user1.address,
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await flpBalance.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(flpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2992, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")

    await flpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2991, 17))

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(liquidityRouter).unstakeAndRedeemFlpForAccount(
      user1.address,
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("994009000000000000")
  })
})
