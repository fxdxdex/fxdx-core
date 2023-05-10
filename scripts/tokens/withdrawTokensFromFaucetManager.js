const { sendTxn, contractAt } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];
const tokens = require('../core/tokens')[network];

async function main() {
  const { btc, eth, feth, usdc, usdt } = tokens
  const faucetTokens = [btc, eth, feth, usdc, usdt]

  const faucetManager = await contractAt("FaucetManager", addresses.faucetManager)

  const amounts = [
    expandDecimals(996, 15),
    expandDecimals(11, 16),
    expandDecimals(95, 16),
    expandDecimals(1, 23),
    expandDecimals(1, 23),
  ]

  for (let i = 0; i < faucetTokens.length; i++) {
    await sendTxn(
      faucetManager.withdrawToken(faucetTokens[i].address, addresses.admin, amounts[i]),
      "faucetManager.withdrawToken: " + faucetTokens[i].name
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
