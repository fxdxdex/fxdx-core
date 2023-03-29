const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")
const { errors } = require("../../test/core/Vault/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];
const addresses = require('./addresses')[network];

async function main() {
  const { nativeToken, btc, eth, feth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, feth, usdc, usdt];

  const vault = await deployContract("Vault", [])
  // const vault = await contractAt("Vault", addresses.vault)
  const usdf = await deployContract("USDF", [vault.address])
  // const usdf = await contractAt("USDF", addresses.usdf)
  const router = await deployContract("Router", [vault.address, usdf.address, nativeToken.address])
  // const router = await contractAt("Router", "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064")
  const vaultPriceFeed = await deployContract("VaultPriceFeed", [])
  // const vaultPriceFeed = await contractAt("VaultPriceFeed", addresses.vaultPriceFeed)

  await sendTxn(vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)), "vaultPriceFeed.setMaxStrictPriceDeviation") // 0.05 USD
  await sendTxn(vaultPriceFeed.setPriceSampleSpace(1), "vaultPriceFeed.setPriceSampleSpace")
  await sendTxn(vaultPriceFeed.setIsAmmEnabled(false), "vaultPriceFeed.setIsAmmEnabled")

  const flp = await deployContract("FLP", [])
  // const flp = await contractAt("FLP", addresses.flp)
  await sendTxn(flp.setInPrivateTransferMode(true), "flp.setInPrivateTransferMode")
  const flpManager = await deployContract("FlpManager", [vault.address, usdf.address, flp.address, 15 * 60])
  await sendTxn(flpManager.setInPrivateMode(true), "flpManager.setInPrivateMode")

  await sendTxn(flp.setMinter(flpManager.address, true), "flp.setMinter")
  await sendTxn(usdf.addVault(flpManager.address), "usdf.addVault(flpManager)")

  await sendTxn(vault.initialize(
    router.address, // router
    usdf.address, // usdf
    vaultPriceFeed.address // priceFeed
  ), "vault.initialize")

  await sendTxn(vault.setInManagerMode(true), "vault.setInManagerMode")
  await sendTxn(vault.setManager(flpManager.address, true), "vault.setManager")

  await sendTxn(vault.setMinProfitTime(
    24 * 60 * 60, // _minProfitTime
  ), "vault.setMinProfitTime")

  const feeUtilsV2 = await deployContract("FeeUtilsV2", [vault.address])
  // const feeUtilsV2 = await contractAt("FeeUtilsV2", addresses.feeUtilsV2)

  await sendTxn(feeUtilsV2.initialize(
    toUsd(2), // liquidationFeeUsd
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

  await sendTxn(vault.setFeeUtils(feeUtilsV2.address), "vault.setFeeUtils")

  const vaultErrorController = await deployContract("VaultErrorController", [])
  await sendTxn(vault.setErrorController(vaultErrorController.address), "vault.setErrorController")
  await sendTxn(vaultErrorController.setErrors(vault.address, errors), "vaultErrorController.setErrors")

  const vaultUtils = await deployContract("VaultUtils", [vault.address, feeUtilsV2.address])
  await sendTxn(vault.setVaultUtils(vaultUtils.address), "vault.setVaultUtils")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
