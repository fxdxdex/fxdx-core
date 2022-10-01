const { deployContract, contractAt, sendTxn, getFrameSigner } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function getValues() {
  const vault = await contractAt("Vault", addresses.vault)
  const tokenManager = { address: addresses.tokenManager }
  const flpManager = { address: addresses.flpManager }

  const positionRouter = { address: addresses.positionRouter }
  const positionManager = { address: addresses.positionManager }

  return { vault, tokenManager, flpManager, positionRouter, positionManager }
}

async function main() {
  // const signer = await getFrameSigner()

  const admin = addresses.admin
  // const buffer = 24 * 60 * 60
  const buffer = 0;
  const maxTokenSupply = expandDecimals("13250000", 18)

  const { vault, tokenManager, flpManager, positionRouter, positionManager } = await getValues()
  const mintReceiver = tokenManager

  const timelock = await deployContract("Timelock", [
    admin,
    buffer,
    tokenManager.address,
    mintReceiver.address,
    flpManager.address,
    maxTokenSupply,
    10, // marginFeeBasisPoints 0.1%
    100 // maxMarginFeeBasisPoints 1%
  ], "Timelock")

  const deployedTimelock = await contractAt("Timelock", timelock.address)

  await sendTxn(deployedTimelock.setShouldToggleIsLeverageEnabled(true), "deployedTimelock.setShouldToggleIsLeverageEnabled(true)")
  await sendTxn(deployedTimelock.setContractHandler(positionRouter.address, true), "deployedTimelock.setContractHandler(positionRouter)")
  await sendTxn(deployedTimelock.setContractHandler(positionManager.address, true), "deployedTimelock.setContractHandler(positionManager)")

  // set Vault gov to timelock
  await sendTxn(vault.setGov(deployedTimelock.address), "vault.setGov(deployedTimelock.address)")

  // // update gov of vault
  // const vaultGov = await contractAt("Timelock", await vault.gov(), signer)

  // await sendTxn(vaultGov.signalSetGov(vault.address, deployedTimelock.address), "vaultGov.signalSetGov")
  // await sendTxn(deployedTimelock.signalSetGov(vault.address, vaultGov.address), "deployedTimelock.signalSetGov(vault)")

  const signers = [
    addresses.signer1, // coinflipcanada
    addresses.signer2, // G
    addresses.signer3, // kr
    addresses.signer4, // quat
    addresses.signer5 // xhiroz
  ]

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i]
    await sendTxn(deployedTimelock.setContractHandler(signer, true), `deployedTimelock.setContractHandler(${signer})`)
  }

  const keepers = [
    addresses.positionsKeeper // X
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
