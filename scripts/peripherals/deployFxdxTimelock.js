const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const { AddressZero } = ethers.constants

async function runForArbitrum() {
  const admin = addresses.admin
  const rewardManager = { address: ethers.constants.AddressZero }
  const buffer = 24 * 60 * 60
  const longBuffer = 7 * 24 * 60 * 60
  const tokenManager = { address: "0xddDc546e07f1374A07b270b7d863371e575EA96A" }
  const mintReceiver = { address: AddressZero }
  const maxTokenSupply = expandDecimals("13250000", 18)

  const timelock = await deployContract("FxdxTimelock", [
    admin,
    buffer,
    longBuffer,
    rewardManager.address,
    tokenManager.address,
    mintReceiver.address,
    maxTokenSupply
  ], "FxdxTimelock", { gasLimit: 100000000 })
}

async function runForAvax() {
  const admin = addresses.admin
  const rewardManager = { address: ethers.constants.AddressZero }
  const buffer = 24 * 60 * 60
  const longBuffer = 7 * 24 * 60 * 60
  const tokenManager = { address: "0x8b25Ba1cAEAFaB8e9926fabCfB6123782e3B4BC2" }
  const mintReceiver = { address: AddressZero }
  const maxTokenSupply = expandDecimals("13250000", 18)

  const timelock = await deployContract("FxdxTimelock", [
    admin,
    buffer,
    longBuffer,
    rewardManager.address,
    tokenManager.address,
    mintReceiver.address,
    maxTokenSupply
  ])
}

async function main() {
  if (network === "avax") {
    await runForAvax()
    return
  }

  await runForArbitrum()
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
