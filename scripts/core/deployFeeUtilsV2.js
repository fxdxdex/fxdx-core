const { toUsd } = require("../../test/shared/units");
const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const { btc, eth, feth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, feth, usdc, usdt];
  // const { btc, eth, usdc, usdt } = tokens
  // const tokenArr = [btc, eth, usdc, usdt];

  const timelock = await contractAt("Timelock", addresses.timelock)
  const vaultUtils = await contractAt("VaultUtils", addresses.vaultUtils)

  const feeUtilsV2 = await deployContract("FeeUtilsV2", [addresses.vault])
  // const feeUtilsV2 = await contractAt("FeeUtilsV2", addresses.feeUtilsV2)

  await sendTxn(feeUtilsV2.initialize(
    toUsd(5), // liquidationFeeUsd
    true // hasDynamicFees
  ), "feeUtilsV2.initialize")

  await sendTxn(feeUtilsV2.setRolloverInterval(60 * 60), "feeUtilsV2.setRolloverInterval")

  for (const token of tokenArr) {
    await sendTxn(feeUtilsV2.setTokenFeeFactors(
      token.address,
      token.taxBasisPoints,
      token.mintBurnFeeBasisPoints,
      token.swapFeeBasisPoints,
      token.rolloverRateFactor,
      token.relativePnlList,
      token.positionFeeBpsList,
      token.profitFeeBpsList
    ), `feeUtilsV2.setTokenFeeFactors - (${token.name})`)
  }

  await sendTxn(timelock.setFeeUtils(addresses.vault, feeUtilsV2.address), "timelock.setFeeUtils")
  await sendTxn(vaultUtils.setFeeUtils(feeUtilsV2.address), "vaultUtils.setFeeUtils")
  await sendTxn(feeUtilsV2.setGov(timelock.address), "feeUtilsV2.setGov")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
