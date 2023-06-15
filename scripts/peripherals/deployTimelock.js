const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const admin = addresses.admin
  // const buffer = 24 * 60 * 60
  const buffer = 0;
  const maxTokenSupply = expandDecimals("1000000000", 18) // 1B supply limit

  const vault = await contractAt("Vault", addresses.vault)
  const feeUtilsV2 = await contractAt("FeeUtilsV2", addresses.feeUtilsV2)
  const referralStorage = await contractAt("ReferralStorage", addresses.referralStorage)
  const liquidityReferralStorage = await contractAt("LiquidityReferralStorage", addresses.liquidityReferralStorage)

  const tokenManager = { address: addresses.tokenManager }

  const mintReceiver = tokenManager

  const timelock = await deployContract("Timelock", [
    admin,
    buffer,
    tokenManager.address,
    mintReceiver.address,
    addresses.flpManager,
    maxTokenSupply
  ], "Timelock")

  const deployedTimelock = await contractAt("Timelock", timelock.address)
  // const deployedTimelock = await contractAt("Timelock", addresses.timelock)

  await sendTxn(deployedTimelock.setShouldToggleIsLeverageEnabled(true), "deployedTimelock.setShouldToggleIsLeverageEnabled(true)")
  await sendTxn(deployedTimelock.setContractHandler(addresses.positionRouter, true), "deployedTimelock.setContractHandler(positionRouter)")
  await sendTxn(deployedTimelock.setContractHandler(addresses.positionManager, true), "deployedTimelock.setContractHandler(positionManager)")
  await sendTxn(deployedTimelock.setContractHandler(addresses.swapRouter, true), "deployedTimelock.setContractHandler(swapRouter)")
  await sendTxn(deployedTimelock.setContractHandler(addresses.liquidityRouter, true), "deployedTimelock.setContractHandler(liquidityRouter)")
  await sendTxn(deployedTimelock.setContractHandler(addresses.rewardRouterV2, true), "deployedTimelock.setContractHandler(rewardRouterV2)")

  // set Vault gov to timelock
  await sendTxn(vault.setGov(deployedTimelock.address), "vault.setGov(deployedTimelock.address)")
  await sendTxn(feeUtilsV2.setGov(deployedTimelock.address), "feeUtilsV2.setGov(deployedTimelock.address)")
  await sendTxn(referralStorage.setGov(deployedTimelock.address), "referralStorage.setGov(deployedTimelock.address)")
  await sendTxn(liquidityReferralStorage.setGov(deployedTimelock.address), "liquidityReferralStorage.setGov(deployedTimelock.address)")

  // // update gov of vault
  // const vaultGov = await contractAt("Timelock", await vault.gov())

  // await sendTxn(vaultGov.signalSetGov(vault.address, deployedTimelock.address), "vaultGov.signalSetGov")
  // await sendTxn(deployedTimelock.signalSetGov(vault.address, vaultGov.address), "deployedTimelock.signalSetGov(vault)")

  const signers = [
    // addresses.signer1,
    // addresses.signer2,
    // addresses.signer3,
    // addresses.signer4,
  ]

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i]
    await sendTxn(deployedTimelock.setContractHandler(signer, true), `deployedTimelock.setContractHandler(${signer})`)
  }

  const keepers = [
    // addresses.positionsKeeper // X
  ]

  for (let i = 0; i < keepers.length; i++) {
    const keeper = keepers[i]
    await sendTxn(deployedTimelock.setKeeper(keeper, true), `deployedTimelock.setKeeper(${keeper})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
