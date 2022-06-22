const { deployContract, contractAt, writeTmpAddresses, sendTxn } = require("../shared/helpers")

async function main() {
  const tokenManager = await deployContract("TokenManager", [3], "TokenManager")

  const signers = [
    "0x8DCF5dD4aC063006D52c8b62Db1b812fFb819909", // Dovey
    "0x0666AeE1C65566c14203D5CD71FCb72804a05D11", // G
    "0xa185B43611C92A01EC49156E3e376AaDCE8073d3", // Han Wen
    "0x73860A34db032651b768AA130ab2f8eAf722a879", // Krunal Amin
  ]

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
