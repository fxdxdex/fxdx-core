const { deployContract, sendTxn, contractAt } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const { nativeToken } = tokens;

  const orderBook = await deployContract("OrderBook", []);
  // const orderBook = await contractAt("OrderBook", addresses.orderBook);

  // const minExecutionFee = "10000000000000000" // 0.01 for Goerli
  // const minExecutionFee = "100000000000000" // 0.0001 for Arbitrum
  const minExecutionFee = "1000000000000000" // 0.001 ETH for Optimism

  // Arbitrum mainnet addresses
  await sendTxn(orderBook.initialize(
    addresses.router, // router
    addresses.vault, // vault
    nativeToken.address, // weth
    addresses.usdf, // usdf
    minExecutionFee, // minExecutionFeed
    expandDecimals(10, 30) // min purchase token amount usd
  ), "orderBook.initialize");

  // await sendTxn(orderBook.setMinExecutionFee(minExecutionFee), `orderBook.setMinExecutionFee`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
