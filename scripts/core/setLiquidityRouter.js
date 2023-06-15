const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const fastPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)
  const priceFeedGov = await fastPriceFeed.gov()
  const priceFeedTimelock = await contractAt("PriceFeedTimelock", priceFeedGov)

  await sendTxn(
    priceFeedTimelock.setLiquidityRouter(addresses.fastPriceFeed, addresses.liquidityRouter),
    `priceFeedTimelock.setLiquidityRouter(fastPriceFeed, liquidityRouter)`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
