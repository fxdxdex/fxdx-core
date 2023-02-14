const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const vault = await contractAt("Vault", addresses.vault)
  const vaultGov = await vault.gov()

  const vaultTimelock = await contractAt("Timelock", vaultGov)

  const maxLeverage = "1000000" // 100x

  await sendTxn(vaultTimelock.setMaxLeverage(vault.address, maxLeverage), `timelock.setMaxLeverage`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
