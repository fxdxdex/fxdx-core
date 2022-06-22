const { deployContract, contractAt, sendTxn, getFrameSigner } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const addresses = require('../core/addresses')[network];

async function getValues() {
  const vault = await contractAt("Vault", addresses.vault)
  const tokenManager = { address: addresses.tokenManager }
  const mintReceiver = { address: addresses.mintReceiver }

  const positionRouter = { address: addresses.positionRouter }
  const positionManager = { address: addresses.positionManager }

  return { vault, tokenManager, mintReceiver, positionRouter, positionManager }
}

async function main() {
  const signer = await getFrameSigner()

  const admin = addresses.admin
  const buffer = 24 * 60 * 60
  const rewardManager = { address: ethers.constants.AddressZero }
  const maxTokenSupply = expandDecimals("13250000", 18)

  const { vault, tokenManager, mintReceiver, positionRouter, positionManager } = await getValues()

  const timelock = await deployContract("Timelock", [
    admin,
    buffer,
    rewardManager.address,
    tokenManager.address,
    mintReceiver.address,
    maxTokenSupply,
    10, // marginFeeBasisPoints 0.1%
    100 // maxMarginFeeBasisPoints 1%
  ], "Timelock")

  // const deployedTimelock = await contractAt("Timelock", timelock.address, signer)
  const deployedTimelock = await contractAt("Timelock", addresses.timelock)

  // await sendTxn(deployedTimelock.setShouldToggleIsLeverageEnabled(true), "deployedTimelock.setShouldToggleIsLeverageEnabled(true)")
  // await sendTxn(deployedTimelock.setContractHandler(positionRouter.address, true), "deployedTimelock.setContractHandler(positionRouter)")
  // await sendTxn(deployedTimelock.setContractHandler(positionManager.address, true), "deployedTimelock.setContractHandler(positionManager)")

  // // update gov of vault, vaultPriceFeed, fastPriceFeed
  // const vaultGov = await contractAt("Timelock", await vault.gov(), signer)
  const vaultPriceFeed = await contractAt("VaultPriceFeed", await vault.priceFeed())
  // const vaultPriceFeedGov = await contractAt("Timelock", await vaultPriceFeed.gov(), signer)
  const fastPriceFeed = await contractAt("FastPriceFeed", await vaultPriceFeed.secondaryPriceFeed())
  // const fastPriceFeedGov = await contractAt("Timelock", await fastPriceFeed.gov(), signer)

  // await sendTxn(vault.setGov(addresses.timelock), "vault.setGov(timelock)")
  // await sendTxn(fastPriceFeed.setGov(addresses.timelock), "fastPriceFeed.setGov(timelock)")

  // await sendTxn(vaultGov.signalSetGov(vault.address, deployedTimelock.address), "vaultGov.signalSetGov")
  // await sendTxn(vaultPriceFeedGov.signalSetGov(vaultPriceFeed.address, deployedTimelock.address), "vaultPriceFeedGov.signalSetGov")
  // await sendTxn(fastPriceFeedGov.signalSetGov(fastPriceFeed.address, deployedTimelock.address), "fastPriceFeedGov.signalSetGov")

  // await sendTxn(deployedTimelock.signalSetGov(vault.address, vaultGov.address), "deployedTimelock.signalSetGov(vault)")
  // await sendTxn(deployedTimelock.signalSetGov(vaultPriceFeed.address, vaultPriceFeedGov.address), "deployedTimelock.signalSetGov(vaultPriceFeed)")
  // await sendTxn(deployedTimelock.signalSetGov(fastPriceFeed.address, fastPriceFeedGov.address), "deployedTimelock.signalSetGov(fastPriceFeed)")

  const signers = [
    addresses.signer1, // coinflipcanada
    addresses.signer2, // G
    addresses.signer3, // kr
    addresses.signer4, // quat
    addresses.signer5, // xhiroz
    addresses.signer6 // X
  ]

  // for (let i = 0; i < signers.length; i++) {
  //   const signer = signers[i]
  //   await sendTxn(deployedTimelock.setContractHandler(signer, true), `deployedTimelock.setContractHandler(${signer})`)
  // }

  const watchers = signers.concat([
    addresses.signer7, // Dovey
    addresses.signer8, // Han Wen
    addresses.signer9 // Krunal Amin
  ])

  for (let i = 0; i < watchers.length; i++) {
    const watcher = watchers[i]
    await sendTxn(deployedTimelock.signalSetPriceFeedWatcher(fastPriceFeed.address, watcher, true), `deployedTimelock.signalSetPriceFeedWatcher(${watcher})`)
  }

  for (let i = 0; i < watchers.length; i++) {
    const watcher = watchers[i]
    await sendTxn(deployedTimelock.setPriceFeedWatcher(fastPriceFeed.address, watcher, true), `deployedTimelock.setPriceFeedWatcher(${watcher})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
