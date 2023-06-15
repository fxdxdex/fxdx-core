const { contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const timelock = await contractAt("Timelock", addresses.timelock)
  const vaultUtils = await contractAt("VaultUtils", addresses.vaultUtils)

  await sendTxn(timelock.setFeeUtils(addresses.vault, addresses.feeUtilsV2), "timelock.setFeeUtils")
  await sendTxn(vaultUtils.setFeeUtils(addresses.feeUtilsV2), "vaultUtils.setFeeUtils")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
