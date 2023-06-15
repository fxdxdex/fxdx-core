const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const fastPriceFeed = await contractAt("FastPriceFeed", addresses.fastPriceFeed)

  await sendTxn(fastPriceFeed.setTokenManager(addresses.tokenManager), "fastPriceFeed.setTokenManager")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
