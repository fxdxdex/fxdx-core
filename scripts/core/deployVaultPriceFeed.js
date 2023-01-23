const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const vault = await contractAt("Vault", addresses.vault)
  const timelock = await contractAt("Timelock", await vault.gov())

  console.log("timelock.address", timelock.address)

  const vaultPriceFeed = await deployContract("VaultPriceFeed", [])
  // const vaultPriceFeed = await contractAt("VaultPriceFeed", addresses.vaultPriceFeed)

  await sendTxn(vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)), "vaultPriceFeed.setMaxStrictPriceDeviation") // 0.05 USD
  await sendTxn(vaultPriceFeed.setPriceSampleSpace(1), "vaultPriceFeed.setPriceSampleSpace")
  await sendTxn(vaultPriceFeed.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")

  await sendTxn(timelock.signalSetPriceFeed(vault.address, vaultPriceFeed.address), "timelock.signalSetPriceFeed")
  // await sendTxn(timelock.setPriceFeed(vault.address, vaultPriceFeed.address), "timelock.setPriceFeed")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
