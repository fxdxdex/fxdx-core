const { getFrameSigner, deployContract, contractAt, sendTxn, readTmpAddresses, callWithRetries } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toChainlinkPrice } = require("../../test/shared/chainlink")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  // const signer = await getFrameSigner()

  const vault = await contractAt("Vault", addresses.vault)

  const priceFeed = await contractAt("VaultPriceFeed", await vault.priceFeed())
  const priceFeedGov = await priceFeed.gov()
  // const priceFeedTimelock = await contractAt("Timelock", priceFeedGov, signer)
  const priceFeedTimelock = await contractAt("Timelock", priceFeedGov)

  // const priceFeedMethod = "signalPriceFeedSetTokenConfig"
  const priceFeedMethod = "priceFeedSetTokenConfig"

  console.log("vault", vault.address)
  console.log("priceFeed", priceFeed.address)
  console.log("priceFeedTimelock", priceFeedTimelock.address)
  console.log("priceFeedMethod", priceFeedMethod)

  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  for (const token of tokenArr) {
    await sendTxn(priceFeedTimelock[priceFeedMethod](
      priceFeed.address, // _vaultPriceFeed
      token.address, // _token
      token.priceFeed, // _priceFeed
      token.priceDecimals, // _priceDecimals
      token.isStrictStable // _isStrictStable
    ), `priceFeed.${priceFeedMethod}(${token.name}) ${token.address}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
