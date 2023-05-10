const { sendTxn, contractAt } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];
const tokens = require('../core/tokens')[network];

async function main() {
  const { btc, eth, feth, usdc, usdt } = tokens
  const faucetTokens = [btc, eth, feth, usdc, usdt]

  const faucetAmounts = [
    expandDecimals(100, 18),
    expandDecimals(10, 18),
    expandDecimals(1000, 18),
    expandDecimals(1000000, 18),
    expandDecimals(1000000, 18),
  ]

  for (let i = 0; i < faucetTokens.length; i++) {
    const token = faucetTokens[i];
    const tokenContract = await contractAt("Token", token.address)

    await sendTxn(
      tokenContract.transfer(addresses.faucetManager, faucetAmounts[i]),
      "tokenContract.transfer: " + token.name
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
