const { deployContract, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const tokenManager = await deployContract("TokenManager", [4], "TokenManager")

  const signers = [
    addresses.signer1, // Dovey
    addresses.signer2, // G
    addresses.signer3, // Han Wen
    addresses.signer4, // Krunal Amin
    addresses.signer5, // xhiroz
    addresses.signer6 // Bybit Security Team
  ]

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
