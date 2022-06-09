const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../core/Vault/helpers")

use(solidity)

describe("RewardRouter", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()

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
  let busd
  let busdPriceFeed

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

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdf = await deployContract("USDF", [vault.address])
    router = await deployContract("Router", [vault.address, usdf.address, bnb.address])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    flp = await deployContract("FLP", [])

    await initVault(vault, router, usdf, vaultPriceFeed)
    flpManager = await deployContract("FlpManager", [vault.address, usdf.address, flp.address, 24 * 60 * 60])

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

    rewardRouter = await deployContract("RewardRouter", [])
    await rewardRouter.initialize(
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
      flpManager.address
    )

    // allow rewardRouter to stake in stakedFxdxTracker
    await stakedFxdxTracker.setHandler(rewardRouter.address, true)
    // allow bonusFxdxTracker to stake stakedFxdxTracker
    await stakedFxdxTracker.setHandler(bonusFxdxTracker.address, true)
    // allow rewardRouter to stake in bonusFxdxTracker
    await bonusFxdxTracker.setHandler(rewardRouter.address, true)
    // allow bonusFxdxTracker to stake feeFxdxTracker
    await bonusFxdxTracker.setHandler(feeFxdxTracker.address, true)
    await bonusFxdxDistributor.setBonusMultiplier(10000)
    // allow rewardRouter to stake in feeFxdxTracker
    await feeFxdxTracker.setHandler(rewardRouter.address, true)
    // allow feeFxdxTracker to stake bnFxdx
    await bnFxdx.setHandler(feeFxdxTracker.address, true)
    // allow rewardRouter to burn bnFxdx
    await bnFxdx.setMinter(rewardRouter.address, true)

    // allow rewardRouter to mint in flpManager
    await flpManager.setHandler(rewardRouter.address, true)
    // allow rewardRouter to stake in feeFlpTracker
    await feeFlpTracker.setHandler(rewardRouter.address, true)
    // allow stakedFlpTracker to stake feeFlpTracker
    await feeFlpTracker.setHandler(stakedFlpTracker.address, true)
    // allow rewardRouter to sake in stakedFlpTracker
    await stakedFlpTracker.setHandler(rewardRouter.address, true)
    // allow feeFlpTracker to stake flp
    await flp.setHandler(feeFlpTracker.address, true)

    // mint esFxdx for distributors
    await esFxdx.setMinter(wallet.address, true)
    await esFxdx.mint(stakedFxdxDistributor.address, expandDecimals(50000, 18))
    await stakedFxdxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esFxdx per second
    await esFxdx.mint(stakedFlpDistributor.address, expandDecimals(50000, 18))
    await stakedFlpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esFxdx per second

    await esFxdx.setInPrivateTransferMode(true)
    await esFxdx.setHandler(stakedFxdxDistributor.address, true)
    await esFxdx.setHandler(stakedFlpDistributor.address, true)
    await esFxdx.setHandler(stakedFxdxTracker.address, true)
    await esFxdx.setHandler(stakedFlpTracker.address, true)
    await esFxdx.setHandler(rewardRouter.address, true)

    // mint bnFxdx for distributor
    await bnFxdx.setMinter(wallet.address, true)
    await bnFxdx.mint(bonusFxdxDistributor.address, expandDecimals(1500, 18))
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

    await expect(rewardRouter.initialize(
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
      flpManager.address
    )).to.be.revertedWith("RewardRouter: already initialized")
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

    await esFxdx.setMinter(wallet.address, true)
    await esFxdx.mint(user2.address, expandDecimals(500, 18))
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

  it("mintAndStakeFlp, unstakeAndRedeemFlp, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeFlpDistributor.address, expandDecimals(100, 18))
    await feeFlpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))
    const tx0 = await rewardRouter.connect(user1).mintAndStakeFlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    await reportGasUsed(provider, tx0, "mintAndStakeFlp gas used")

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeFlpTracker.depositBalances(user1.address, flp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedFlpTracker.depositBalances(user1.address, feeFlpTracker.address)).eq(expandDecimals(2991, 17))

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(2, 18))
    await rewardRouter.connect(user1).mintAndStakeFlp(
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
    await rewardRouter.connect(user2).mintAndStakeFlp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await expect(rewardRouter.connect(user2).unstakeAndRedeemFlp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user2.address
    )).to.be.revertedWith("FlpManager: cooldown duration not yet passed")

    expect(await feeFlpTracker.stakedAmounts(user1.address)).eq("897300000000000000000") // 897.3
    expect(await stakedFlpTracker.stakedAmounts(user1.address)).eq("897300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq(0)

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemFlp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address
    )
    await reportGasUsed(provider, tx1, "unstakeAndRedeemFlp gas used")

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

  it("mintAndStakeFlpETH, unstakeAndRedeemFlpETH", async () => {
    const receiver0 = newWallet()
    await expect(rewardRouter.connect(user0).mintAndStakeFlpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: 0 }))
      .to.be.revertedWith("RewardRouter: invalid msg.value")

    await expect(rewardRouter.connect(user0).mintAndStakeFlpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("FlpManager: insufficient USDF output")

    await expect(rewardRouter.connect(user0).mintAndStakeFlpETH(expandDecimals(299, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("FlpManager: insufficient FLP output")

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(0)
    expect(await bnb.totalSupply()).eq(0)
    expect(await provider.getBalance(bnb.address)).eq(0)
    expect(await stakedFlpTracker.balanceOf(user0.address)).eq(0)

    await rewardRouter.connect(user0).mintAndStakeFlpETH(expandDecimals(299, 18), expandDecimals(299, 18), { value: expandDecimals(1, 18) })

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(expandDecimals(1, 18))
    expect(await provider.getBalance(bnb.address)).eq(expandDecimals(1, 18))
    expect(await bnb.totalSupply()).eq(expandDecimals(1, 18))
    expect(await stakedFlpTracker.balanceOf(user0.address)).eq("299100000000000000000") // 299.1

    await expect(rewardRouter.connect(user0).unstakeAndRedeemFlpETH(expandDecimals(300, 18), expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await expect(rewardRouter.connect(user0).unstakeAndRedeemFlpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("FlpManager: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)

    await expect(rewardRouter.connect(user0).unstakeAndRedeemFlpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("FlpManager: insufficient output")

    await rewardRouter.connect(user0).unstakeAndRedeemFlpETH("299100000000000000000", "990000000000000000", receiver0.address)
    expect(await provider.getBalance(receiver0.address)).eq("994009000000000000") // 0.994009
    expect(await bnb.balanceOf(vault.address)).eq("5991000000000000") // 0.005991
    expect(await provider.getBalance(bnb.address)).eq("5991000000000000")
    expect(await bnb.totalSupply()).eq("5991000000000000")
  })
})
