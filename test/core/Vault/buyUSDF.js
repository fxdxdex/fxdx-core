const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig, validateVaultBalance } = require("./helpers")

use(solidity)

describe("Vault.buyUSDF", function () {
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

  let flpManager
  let flp

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

    flp = await deployContract("FLP", [])
    flpManager = await deployContract("FlpManager", [vault.address, usdf.address, flp.address, 24 * 60 * 60])
  })

  it("buyUSDF", async () => {
    await expect(vault.buyUSDF(bnb.address, wallet.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await expect(vault.connect(user0).buyUSDF(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await expect(vault.connect(user0).buyUSDF(bnb.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)

    await bnb.mint(user0.address, 100)
    await bnb.connect(user0).transfer(vault.address, 100)
    const tx = await vault.connect(user0).buyUSDF(bnb.address, user1.address, { gasPrice: "10000000000" })
    await reportGasUsed(provider, tx, "buyUSDF gas used")

    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(29700)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdfAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)

    await validateVaultBalance(expect, vault, bnb)

    expect(await flpManager.getAumInUsdf(true)).eq(29700)
  })

  it("buyUSDF allows gov to mint", async () => {
    await vault.setInManagerMode(true)
    await expect(vault.buyUSDF(bnb.address, wallet.address))
      .to.be.revertedWith("Vault: forbidden")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await bnb.mint(wallet.address, 100)
    await bnb.transfer(vault.address, 100)

    expect(await usdf.balanceOf(wallet.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)

    await expect(vault.connect(user0).buyUSDF(bnb.address, wallet.address))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setManager(user0.address, true)
    await vault.connect(user0).buyUSDF(bnb.address, wallet.address)

    expect(await usdf.balanceOf(wallet.address)).eq(29700)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdfAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)

    await validateVaultBalance(expect, vault, bnb)
  })

  it("buyUSDF uses min price", async () => {
    await expect(vault.connect(user0).buyUSDF(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(200))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(250))

    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await bnb.mint(user0.address, 100)
    await bnb.connect(user0).transfer(vault.address, 100)
    await vault.connect(user0).buyUSDF(bnb.address, user1.address)
    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(19800)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdfAmounts(bnb.address)).eq(19800)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)

    await validateVaultBalance(expect, vault, bnb)
  })

  it("buyUSDF updates fees", async () => {
    await expect(vault.connect(user0).buyUSDF(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await bnb.mint(user0.address, 10000)
    await bnb.connect(user0).transfer(vault.address, 10000)
    await vault.connect(user0).buyUSDF(bnb.address, user1.address)
    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(9970 * 300)
    expect(await vault.feeReserves(bnb.address)).eq(30)
    expect(await vault.usdfAmounts(bnb.address)).eq(9970 * 300)
    expect(await vault.poolAmounts(bnb.address)).eq(10000 - 30)

    await validateVaultBalance(expect, vault, bnb)
  })

  it("buyUSDF uses mintBurnFeeBasisPoints", async () => {
    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await vault.setMinProfitTime(0)

    await feeUtils.setFees(
      50, // _taxBasisPoints
      10, // _stableTaxBasisPoints
      4, // _mintBurnFeeBasisPoints
      30, // _swapFeeBasisPoints
      4, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(5), // _liquidationFeeUsd
      false // _hasDynamicFees
    )

    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await dai.mint(user0.address, expandDecimals(10000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
    await vault.connect(user0).buyUSDF(dai.address, user1.address)
    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(expandDecimals(10000 - 4, 18))
    expect(await vault.feeReserves(dai.address)).eq(expandDecimals(4, 18))
    expect(await vault.usdfAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
    expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
  })

  it("buyUSDF adjusts for decimals", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await expect(vault.connect(user0).buyUSDF(btc.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await usdf.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdfAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
    await vault.connect(user0).buyUSDF(btc.address, user1.address)
    expect(await usdf.balanceOf(user0.address)).eq(0)
    expect(await vault.feeReserves(btc.address)).eq(300000)
    expect(await usdf.balanceOf(user1.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18))) // 0.3% of 60,000 => 180
    expect(await vault.usdfAmounts(btc.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub(300000))

    await validateVaultBalance(expect, vault, btc)
  })
})
