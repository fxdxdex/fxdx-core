const { deployContract, sendTxn, contractAt } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const tokenManager = await deployContract("TokenManager", [3], "TokenManager")
  // const tokenManager = await contractAt("TokenManager", addresses.tokenManager)

  const signers = [
    addresses.signer1,
    addresses.signer2,
    addresses.signer3,
    addresses.signer4,
  ]

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
