const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const fastPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)
  const priceFeedGov = await fastPriceFeed.gov()
  const priceFeedTimelock = await contractAt("PriceFeedTimelock", priceFeedGov)

  const priceFeedMethod = "signalSetPriceFeedUpdater"
  // const priceFeedMethod = "setPriceFeedUpdater"

  const updater = addresses.positionManager

  await sendTxn(
    priceFeedTimelock[priceFeedMethod](fastPriceFeed.address, updater, true),
    `priceFeedTimelock.${priceFeedMethod}`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
