const { sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];
const tokens = require('../core/tokens')[network];

async function main() {
  const faucetManager = await contractAt("FaucetManager", addresses.faucetManager)

  await sendTxn(faucetManager.claimToken(tokens.nativeToken.address, true), "faucetManager.claimToken")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
