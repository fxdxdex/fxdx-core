const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("FlpManager", function () {
  const provider = waffle.provider
  const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
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
  let distributor0
  let yieldTracker0
  let reader

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

    await flp.setInPrivateTransferMode(true)
    await flp.setMinter(flpManager.address, true)

    await vault.setInManagerMode(true)
  })

  it("inits", async () => {
    expect(await flpManager.gov()).eq(wallet.address)
    expect(await flpManager.vault()).eq(vault.address)
    expect(await flpManager.usdf()).eq(usdf.address)
    expect(await flpManager.flp()).eq(flp.address)
    expect(await flpManager.cooldownDuration()).eq(24 * 60 * 60)
  })

  it("setGov", async () => {
    await expect(flpManager.connect(user0).setGov(user1.address))
      .to.be.revertedWith("Governable: forbidden")

    expect(await flpManager.gov()).eq(wallet.address)

    await flpManager.setGov(user0.address)
    expect(await flpManager.gov()).eq(user0.address)

    await flpManager.connect(user0).setGov(user1.address)
    expect(await flpManager.gov()).eq(user1.address)
  })

  it("setHandler", async () => {
    await expect(flpManager.connect(user0).setHandler(user1.address, true))
      .to.be.revertedWith("Governable: forbidden")

    expect(await flpManager.gov()).eq(wallet.address)
    await flpManager.setGov(user0.address)
    expect(await flpManager.gov()).eq(user0.address)

    expect(await flpManager.isHandler(user1.address)).eq(false)
    await flpManager.connect(user0).setHandler(user1.address, true)
    expect(await flpManager.isHandler(user1.address)).eq(true)
  })

  it("setCooldownDuration", async () => {
    await expect(flpManager.connect(user0).setCooldownDuration(1000))
      .to.be.revertedWith("Governable: forbidden")

    await flpManager.setGov(user0.address)

    await expect(flpManager.connect(user0).setCooldownDuration(48 * 60 * 60 + 1))
      .to.be.revertedWith("FlpManager: invalid _cooldownDuration")

    expect(await flpManager.cooldownDuration()).eq(24 * 60 * 60)
    await flpManager.connect(user0).setCooldownDuration(48 * 60 * 60)
    expect(await flpManager.cooldownDuration()).eq(48 * 60 * 60)
  })

  it("setAumAdjustment", async () => {
    await expect(flpManager.connect(user0).setAumAdjustment(29, 17))
      .to.be.revertedWith("Governable: forbidden")

    await flpManager.setGov(user0.address)

    expect(await flpManager.aumAddition()).eq(0)
    expect(await flpManager.aumDeduction()).eq(0)
    expect(await flpManager.getAum(true)).eq(0)
    await flpManager.connect(user0).setAumAdjustment(29, 17)
    expect(await flpManager.aumAddition()).eq(29)
    expect(await flpManager.aumDeduction()).eq(17)
    expect(await flpManager.getAum(true)).eq(12)
  })

  it("addLiquidity, removeLiquidity", async () => {
    await dai.mint(user0.address, expandDecimals(100, 18))
    await dai.connect(user0).approve(flpManager.address, expandDecimals(100, 18))

    await expect(flpManager.connect(user0).addLiquidity(
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("Vault: forbidden")

    await vault.setManager(flpManager.address, true)

    await expect(flpManager.connect(user0).addLiquidity(
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("FlpManager: insufficient USDF output")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))

    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(100, 18))
    expect(await dai.balanceOf(vault.address)).eq(0)
    expect(await usdf.balanceOf(flpManager.address)).eq(0)
    expect(await flp.balanceOf(user0.address)).eq(0)
    expect(await flpManager.lastAddedAt(user0.address)).eq(0)
    expect(await flpManager.getAumInUsdf(true)).eq(0)

    const tx0 = await flpManager.connect(user0).addLiquidity(
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(99, 18),
      expandDecimals(99, 18)
    )
    await reportGasUsed(provider, tx0, "addLiquidity gas used")

    let blockTime = await getBlockTime(provider)

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(vault.address)).eq(expandDecimals(100, 18))
    expect(await usdf.balanceOf(flpManager.address)).eq("99700000000000000000") // 99.7
    expect(await flp.balanceOf(user0.address)).eq("99700000000000000000")
    expect(await flp.totalSupply()).eq("99700000000000000000")
    expect(await flpManager.lastAddedAt(user0.address)).eq(blockTime)
    expect(await flpManager.getAumInUsdf(true)).eq("99700000000000000000")
    expect(await flpManager.getAumInUsdf(false)).eq("99700000000000000000")

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))

    await flpManager.connect(user1).addLiquidity(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    blockTime = await getBlockTime(provider)

    expect(await usdf.balanceOf(flpManager.address)).eq("398800000000000000000") // 398.8
    expect(await flp.balanceOf(user0.address)).eq("99700000000000000000") // 99.7
    expect(await flp.balanceOf(user1.address)).eq("299100000000000000000") // 299.1
    expect(await flp.totalSupply()).eq("398800000000000000000")
    expect(await flpManager.lastAddedAt(user1.address)).eq(blockTime)
    expect(await flpManager.getAumInUsdf(true)).eq("498500000000000000000")
    expect(await flpManager.getAumInUsdf(false)).eq("398800000000000000000")

    await expect(flp.connect(user1).transfer(user2.address, expandDecimals(1, 18)))
      .to.be.revertedWith("BaseToken: msg.sender not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))

    expect(await flpManager.getAumInUsdf(true)).eq("598200000000000000000") // 598.2
    expect(await flpManager.getAumInUsdf(false)).eq("498500000000000000000") // 498.5

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))

    await btc.mint(user2.address, "1000000") // 0.01 BTC, $500
    await btc.connect(user2).approve(flpManager.address, expandDecimals(1, 18))

    await expect(flpManager.connect(user2).addLiquidity(
      btc.address,
      "1000000",
      expandDecimals(599, 18),
      expandDecimals(399, 18)
    )).to.be.revertedWith("FlpManager: insufficient USDF output")

    await expect(flpManager.connect(user2).addLiquidity(
      btc.address,
      "1000000",
      expandDecimals(598, 18),
      expandDecimals(399, 18)
    )).to.be.revertedWith("FlpManager: insufficient FLP output")

    await flpManager.connect(user2).addLiquidity(
      btc.address,
      "1000000",
      expandDecimals(598, 18),
      expandDecimals(398, 18)
    )

    blockTime = await getBlockTime(provider)

    expect(await usdf.balanceOf(flpManager.address)).eq("997000000000000000000") // 997
    expect(await flp.balanceOf(user0.address)).eq("99700000000000000000") // 99.7
    expect(await flp.balanceOf(user1.address)).eq("299100000000000000000") // 299.1
    expect(await flp.balanceOf(user2.address)).eq("398800000000000000000") // 398.8
    expect(await flp.totalSupply()).eq("797600000000000000000") // 797.6
    expect(await flpManager.lastAddedAt(user2.address)).eq(blockTime)
    expect(await flpManager.getAumInUsdf(true)).eq("1196400000000000000000") // 1196.4
    expect(await flpManager.getAumInUsdf(false)).eq("1096700000000000000000") // 1096.7

    await expect(flpManager.connect(user0).removeLiquidity(
      dai.address,
      "99700000000000000000",
      expandDecimals(123, 18),
      user0.address
    )).to.be.revertedWith("FlpManager: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    await expect(flpManager.connect(user0).removeLiquidity(
      dai.address,
      expandDecimals(73, 18),
      expandDecimals(100, 18),
      user0.address
    )).to.be.revertedWith("Vault: poolAmount exceeded")

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await flp.balanceOf(user0.address)).eq("99700000000000000000") // 99.7

    await flpManager.connect(user0).removeLiquidity(
      dai.address,
      expandDecimals(72, 18),
      expandDecimals(98, 18),
      user0.address
    )

    expect(await dai.balanceOf(user0.address)).eq("98703000000000000000") // 98.703, 72 * 1096.7 / 797.6 => 99
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await flp.balanceOf(user0.address)).eq("27700000000000000000") // 27.7

    await flpManager.connect(user0).removeLiquidity(
      bnb.address,
      "27700000000000000000", // 27.7, 27.7 * 1096.7 / 797.6 => 38.0875
      "75900000000000000", // 0.0759 BNB => 37.95 USD
      user0.address
    )

    expect(await dai.balanceOf(user0.address)).eq("98703000000000000000")
    expect(await bnb.balanceOf(user0.address)).eq("75946475000000000") // 0.075946475
    expect(await flp.balanceOf(user0.address)).eq(0)

    expect(await flp.totalSupply()).eq("697900000000000000000") // 697.9
    expect(await flpManager.getAumInUsdf(true)).eq("1059312500000000000000") // 1059.3125
    expect(await flpManager.getAumInUsdf(false)).eq("967230000000000000000") // 967.23

    expect(await bnb.balanceOf(user1.address)).eq(0)
    expect(await flp.balanceOf(user1.address)).eq("299100000000000000000")

    await flpManager.connect(user1).removeLiquidity(
      bnb.address,
      "299100000000000000000", // 299.1, 299.1 * 967.23 / 697.9 => 414.527142857
      "826500000000000000", // 0.8265 BNB => 413.25
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("826567122857142856") // 0.826567122857142856
    expect(await flp.balanceOf(user1.address)).eq(0)

    expect(await flp.totalSupply()).eq("398800000000000000000") // 398.8
    expect(await flpManager.getAumInUsdf(true)).eq("644785357142857143000") // 644.785357142857143
    expect(await flpManager.getAumInUsdf(false)).eq("635608285714285714400") // 635.6082857142857144

    expect(await btc.balanceOf(user2.address)).eq(0)
    expect(await flp.balanceOf(user2.address)).eq("398800000000000000000") // 398.8

    expect(await vault.poolAmounts(dai.address)).eq("700000000000000000") // 0.7
    expect(await vault.poolAmounts(bnb.address)).eq("91770714285714286") // 0.091770714285714286
    expect(await vault.poolAmounts(btc.address)).eq("997000") // 0.00997

    await expect(flpManager.connect(user2).removeLiquidity(
      btc.address,
      expandDecimals(375, 18),
      "990000", // 0.0099
      user2.address
    )).to.be.revertedWith("USDF: forbidden")

    await usdf.addVault(flpManager.address)

    const tx1 = await flpManager.connect(user2).removeLiquidity(
      btc.address,
      expandDecimals(375, 18),
      "990000", // 0.0099
      user2.address
    )
    await reportGasUsed(provider, tx1, "removeLiquidity gas used")

    expect(await btc.balanceOf(user2.address)).eq("993137")
    expect(await flp.balanceOf(user2.address)).eq("23800000000000000000") // 23.8
  })

  it("addLiquidityForAccount, removeLiquidityForAccount", async () => {
    await vault.setManager(flpManager.address, true)
    await flpManager.setInPrivateMode(true)
    await flpManager.setHandler(rewardRouter.address, true)

    await dai.mint(user3.address, expandDecimals(100, 18))
    await dai.connect(user3).approve(flpManager.address, expandDecimals(100, 18))

    await expect(flpManager.connect(user0).addLiquidityForAccount(
      user3.address,
      user0.address,
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("FlpManager: forbidden")

    await expect(flpManager.connect(rewardRouter).addLiquidityForAccount(
      user3.address,
      user0.address,
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(101, 18),
      expandDecimals(101, 18)
    )).to.be.revertedWith("FlpManager: insufficient USDF output")

    expect(await dai.balanceOf(user3.address)).eq(expandDecimals(100, 18))
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(vault.address)).eq(0)
    expect(await usdf.balanceOf(flpManager.address)).eq(0)
    expect(await flp.balanceOf(user0.address)).eq(0)
    expect(await flpManager.lastAddedAt(user0.address)).eq(0)
    expect(await flpManager.getAumInUsdf(true)).eq(0)

    await flpManager.connect(rewardRouter).addLiquidityForAccount(
      user3.address,
      user0.address,
      dai.address,
      expandDecimals(100, 18),
      expandDecimals(99, 18),
      expandDecimals(99, 18)
    )

    let blockTime = await getBlockTime(provider)

    expect(await dai.balanceOf(user3.address)).eq(0)
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(vault.address)).eq(expandDecimals(100, 18))
    expect(await usdf.balanceOf(flpManager.address)).eq("99700000000000000000") // 99.7
    expect(await flp.balanceOf(user0.address)).eq("99700000000000000000")
    expect(await flp.totalSupply()).eq("99700000000000000000")
    expect(await flpManager.lastAddedAt(user0.address)).eq(blockTime)
    expect(await flpManager.getAumInUsdf(true)).eq("99700000000000000000")

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(flpManager.address, expandDecimals(1, 18))

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    await flpManager.connect(rewardRouter).addLiquidityForAccount(
      user1.address,
      user1.address,
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    blockTime = await getBlockTime(provider)

    expect(await usdf.balanceOf(flpManager.address)).eq("398800000000000000000") // 398.8
    expect(await flp.balanceOf(user0.address)).eq("99700000000000000000")
    expect(await flp.balanceOf(user1.address)).eq("299100000000000000000")
    expect(await flp.totalSupply()).eq("398800000000000000000")
    expect(await flpManager.lastAddedAt(user1.address)).eq(blockTime)
    expect(await flpManager.getAumInUsdf(true)).eq("398800000000000000000")

    await expect(flpManager.connect(user1).removeLiquidityForAccount(
      user1.address,
      bnb.address,
      "99700000000000000000",
      expandDecimals(290, 18),
      user1.address
    )).to.be.revertedWith("FlpManager: forbidden")

    await expect(flpManager.connect(rewardRouter).removeLiquidityForAccount(
      user1.address,
      bnb.address,
      "99700000000000000000",
      expandDecimals(290, 18),
      user1.address
    )).to.be.revertedWith("FlpManager: cooldown duration not yet passed")

    await flpManager.connect(rewardRouter).removeLiquidityForAccount(
      user0.address,
      dai.address,
      "79760000000000000000", // 79.76
      "79000000000000000000", // 79
      user0.address
    )

    expect(await dai.balanceOf(user0.address)).eq("79520720000000000000")
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await flp.balanceOf(user0.address)).eq("19940000000000000000") // 19.94
  })
})
