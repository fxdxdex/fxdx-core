const { getFrameSigner, deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

// TODO: call setSpreadBasisPoints for tokens
async function deployPriceFeed() {
  // const { btc, eth, usdc, link, uni, usdt, mim, frax, dai } = tokens
  // const tokenArr = [btc, eth, usdc, link, uni, usdt, mim, frax, dai]
  // const fastPriceTokens = [btc, eth, link, uni]
  // const { btc, eth, feth, usdc, usdt } = tokens
  // const tokenArr = [btc, eth, feth, usdc, usdt]
  // const fastPriceTokens = [btc, eth, feth]
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]
  const fastPriceTokens = [btc, eth]

  if (fastPriceTokens.find(t => !t.fastPricePrecision)) {
    throw new Error("Invalid price precision")
  }

  if (fastPriceTokens.find(t => !t.maxCumulativeDeltaDiff)) {
    throw new Error("Invalid price maxCumulativeDeltaDiff")
  }

  // const signer = await getFrameSigner()

  const timelock = { address: addresses.priceFeedTimelock }

  const updater1 = { address: addresses.priceSender }
  // const updater2 = { address: "0x13e12390fFFc8dA71708bbc90F0Bf2c07FbE6B7A" }
  // const keeper1 = { address: addresses.positionsKeeper }
  // const keeper2 = { address: "0xA73731077B511b39853Fb149AfeC948d3DB9BA71" }
  const updaters = [updater1.address, /*updater2.address, keeper1.address, keeper2.address*/]

  const signers = [
    addresses.signer1,
    addresses.signer2,
    addresses.signer3,
    addresses.signer4,
  ]
  const tokenManager = { address: addresses.tokenManager }

  const positionManager = await contractAt("PositionManager", addresses.positionManager)
  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  const swapRouter = await contractAt("SwapRouter", addresses.swapRouter)
  const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouter)

  // const fastPriceEvents = await contractAt("FastPriceEvents", addresses.fastPriceEvents)
  const fastPriceEvents = await deployContract("FastPriceEvents", [])

  // const chainlinkFlags = { address: "0x3C14e07Edd0dC67442FA96f1Ec6999c57E810a83" }
  const secondaryPriceFeed = await deployContract("FastPriceFeed", [
    5 * 60, // _priceDuration
    60 * 60, // _maxPriceUpdateDelay
    0, // _minBlockInterval
    750, // _maxDeviationBasisPoints
    fastPriceEvents.address, // _fastPriceEvents
    tokenManager.address, // _tokenManager
    positionRouter.address,
    swapRouter.address,
    liquidityRouter.address
  ])
  // const secondaryPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed);

  await sendTxn(secondaryPriceFeed.initialize(3, signers, updaters), "secondaryPriceFeed.initialize")
  await sendTxn(secondaryPriceFeed.setMaxTimeDeviation(60 * 60), "secondaryPriceFeed.setMaxTimeDeviation")
  await sendTxn(
    secondaryPriceFeed.setUpdater(positionManager.address, true),
    "secondaryPriceFeed.setUpdater(positionManger, true)"
  )

  await sendTxn(positionManager.setFastPriceFeed(secondaryPriceFeed.address), "positionManager.setFastPriceFeed")

  await sendTxn(positionRouter.setPositionKeeper(secondaryPriceFeed.address, true), "positionRouter.setPositionKeeper(secondaryPriceFeed)")
  await sendTxn(swapRouter.setRequestKeeper(secondaryPriceFeed.address, true), "swapRouter.setRequestKeeper(secondaryPriceFeed)")
  await sendTxn(liquidityRouter.setRequestKeeper(secondaryPriceFeed.address, true), "liquidityRouter.setRequestKeeper(secondaryPriceFeed)")

  await sendTxn(fastPriceEvents.setIsPriceFeed(secondaryPriceFeed.address, true), "fastPriceEvents.setIsPriceFeed")

  // const vaultPriceFeed = await deployContract("VaultPriceFeed", [])
  const vaultPriceFeed = await contractAt("VaultPriceFeed", addresses.vaultPriceFeed);

  await sendTxn(vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)), "vaultPriceFeed.setMaxStrictPriceDeviation") // 0.05 USD
  await sendTxn(vaultPriceFeed.setPriceSampleSpace(1), "vaultPriceFeed.setPriceSampleSpace")
  await sendTxn(vaultPriceFeed.setSecondaryPriceFeed(secondaryPriceFeed.address), "vaultPriceFeed.setSecondaryPriceFeed")
  await sendTxn(vaultPriceFeed.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")
  // await sendTxn(vaultPriceFeed.setChainlinkFlags(chainlinkFlags.address), "vaultPriceFeed.setChainlinkFlags")

  for (const token of tokenArr) {
    await sendTxn(vaultPriceFeed.setTokenConfig(
      token.address, // _token
      token.priceFeed, // _priceFeed
      token.priceDecimals, // _priceDecimals
      token.isStrictStable // _isStrictStable
    ), `vaultPriceFeed.setTokenConfig(${token.name}) ${token.address} ${token.priceFeed}`)
  }

  await sendTxn(vaultPriceFeed.setGov(timelock.address), "vaultPriceFeed.setGov")
  await sendTxn(secondaryPriceFeed.setTokens(fastPriceTokens.map(t => t.address), fastPriceTokens.map(t => t.fastPricePrecision)), "secondaryPriceFeed.setTokens")
  await sendTxn(secondaryPriceFeed.setVaultPriceFeed(vaultPriceFeed.address), "secondaryPriceFeed.setVaultPriceFeed")
  await sendTxn(secondaryPriceFeed.setMaxTimeDeviation(60 * 60), "secondaryPriceFeed.setMaxTimeDeviation")
  await sendTxn(secondaryPriceFeed.setSpreadBasisPointsIfInactive(50), "secondaryPriceFeed.setSpreadBasisPointsIfInactive")
  await sendTxn(secondaryPriceFeed.setSpreadBasisPointsIfChainError(500), "secondaryPriceFeed.setSpreadBasisPointsIfChainError")
  await sendTxn(secondaryPriceFeed.setMaxCumulativeDeltaDiffs(fastPriceTokens.map(t => t.address), fastPriceTokens.map(t => t.maxCumulativeDeltaDiff)), "secondaryPriceFeed.setMaxCumulativeDeltaDiffs")
  await sendTxn(secondaryPriceFeed.setPriceDataInterval(5 * 60), "secondaryPriceFeed.setPriceDataInterval")
  await sendTxn(secondaryPriceFeed.setGov(timelock.address), "secondaryPriceFeed.setGov")
}

async function main() {
  await deployPriceFeed()
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
