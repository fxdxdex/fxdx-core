const { contractAt, sendTxn } = require("../shared/helpers")
const { bigNumberify, expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network]

async function getValues() {
  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  const positionManager = await contractAt("PositionManager", addresses.positionManager)

  const { btc, eth, feth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, feth, usdc, usdt]

  return { positionRouter, positionManager, tokenArr }
}

async function main() {
  const { positionRouter, positionManager, tokenArr } = await getValues()

  const tokenAddresses = tokenArr.map(t => t.address)
  const longSizes = tokenArr.map((token) => {
    if (!token.maxGlobalLongSize) {
      return bigNumberify(0)
    }

    return expandDecimals(token.maxGlobalLongSize, 30)
  })

  const shortSizes = tokenArr.map((token) => {
    if (!token.maxGlobalShortSize) {
      return bigNumberify(0)
    }

    return expandDecimals(token.maxGlobalShortSize, 30)
  })

  await sendTxn(positionRouter.setMaxGlobalSizes(tokenAddresses, longSizes, shortSizes), "positionRouter.setMaxGlobalSizes")
  await sendTxn(positionManager.setMaxGlobalSizes(tokenAddresses, longSizes, shortSizes), "positionManager.setMaxGlobalSizes")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
