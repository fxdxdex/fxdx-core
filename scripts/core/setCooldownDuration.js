const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const flpManager = await contractAt("FlpManager", addresses.flpManager);

  await sendTxn(flpManager.setCooldownDuration(0), "flpManager.setCooldownDuration")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
