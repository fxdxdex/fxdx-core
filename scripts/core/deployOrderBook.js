const { deployContract, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const { nativeToken } = tokens

  const orderBook = await deployContract("OrderBook", []);

  // const minExecutionFee = "10000000000000000" // 0.01 for L1
  const minExecutionFee = "100000000000000" // 0.0001 for L2

  // Arbitrum mainnet addresses
  await sendTxn(orderBook.initialize(
    addresses.router, // router
    addresses.vault, // vault
    nativeToken.address, // weth
    addresses.usdf, // usdf
    minExecutionFee, // 0.01 AVAX
    expandDecimals(10, 30) // min purchase token amount usd
  ), "orderBook.initialize");
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
