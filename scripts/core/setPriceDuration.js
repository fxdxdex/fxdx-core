const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const vault = await contractAt("Vault", addresses.vault)

  const fastPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)
  const priceFeedGov = await fastPriceFeed.gov()
  const priceFeedTimelock = await contractAt("PriceFeedTimelock", priceFeedGov)

  await sendTxn(
    priceFeedTimelock.setPriceDuration(addresses.fastPriceFeed, 30 * 60),
    `priceFeedTimelock.setPriceDuration(fastPriceFeedAddress, ${30 * 60})`
  )
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
