const { toUsd } = require("../../test/shared/units");
const { expandDecimals } = require("../../test/shared/utilities");
const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const addresses = require('../core/addresses')[network];

async function main() {
  const mintReceiver = addresses.admin
  const mintAmount = expandDecimals(5000, 18)
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)

  // await sendTxn(esFxdx.setMinter(
  //   addresses.admin,
  //   true
  // ), "esFxdx.setMinter(admin, true)")

  await sendTxn(esFxdx.mint(
    mintReceiver, // liquidationFeeUsd
    mintAmount
  ), "esFxdx.mint")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
