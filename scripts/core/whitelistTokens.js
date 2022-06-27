const { deployContract, contractAt, sendTxn, callWithRetries } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toChainlinkPrice } = require("../../test/shared/chainlink")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const vault = await contractAt("Vault", addresses.vault)
  const vaultPriceFeed = await contractAt("VaultPriceFeed", addresses.vaultPriceFeed)
  console.log("vault", vault.address)
  console.log("vaultPriceFeed", vaultPriceFeed.address)

  const { btc, eth, usdt, usdc } = tokens
  const tokenArr = [btc, eth, usdt, usdc]

  for (const token of tokenArr) {
    await sendTxn(vaultPriceFeed.setTokenConfig(
      token.address, // _token
      token.priceFeed, // _priceFeed
      token.priceDecimals, // _priceDecimals
      token.isStrictStable // _isStrictStable
    ), `vaultPriceFeed.setTokenConfig(${token.name}) ${token.address} ${token.priceFeed}`)

    await sendTxn(vault.setTokenConfig(
      token.address, // _token
      token.decimals, // _tokenDecimals
      token.tokenWeight, // _tokenWeight
      token.minProfitBps, // _minProfitBps
      expandDecimals(token.maxUsdfAmount, 18), // _maxUsdfAmount
      token.isStable, // _isStable
      token.isShortable // _isShortable
    ), `vault.setTokenConfig(${token.name}) ${token.address}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
