const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  await deployContract("FeeUtilsV2", [addresses.vault])
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
