const { deployContract, contractAt, writeTmpAddresses } = require("../shared/helpers")

async function main() {
  await deployContract("MintableBaseToken", ["VestingOption", "ARB:FXDX", 0])
  await deployContract("MintableBaseToken", ["VestingOption", "ARB:FLP", 0])
  await deployContract("MintableBaseToken", ["VestingOption", "AVAX:FXDX", 0])
  await deployContract("MintableBaseToken", ["VestingOption", "AVAX:FLP", 0])
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
