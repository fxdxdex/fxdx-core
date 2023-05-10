const { deployContract, sendTxn, contractAt } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];
const tokens = require('../core/tokens')[network];

async function main() {
  const { btc, eth, feth, usdc, usdt } = tokens
  const faucetTokens = [btc, eth, feth, usdc, usdt]

  const faucetManager = await deployContract("FaucetManager", [tokens.nativeToken.address])
  // const faucetManager = await contractAt("FaucetManager", addresses.faucetManager)

  await sendTxn(faucetManager.initialize(
    faucetTokens.map(token => token.address),
    faucetTokens.map(token => expandDecimals(token.faucetAmount * (10 ** 6), token.decimals - 6))
  ), "faucetManager.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
