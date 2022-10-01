const { deployContract } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const addresses = require('../core/addresses')[network]

async function getValues() {
  const flp = { address: addresses.flp }
  const flpManager = { address: addresses.flpManager }
  const stakedFlpTracker = { address: addresses.stakedFlpTracker }
  const feeFlpTracker = { address: addresses.feeFlpTracker }

  return { flp, flpManager, stakedFlpTracker, feeFlpTracker }
}

async function main() {
  const { flp, flpManager, stakedFlpTracker, feeFlpTracker } = await getValues()

  await deployContract("StakedFlp", [
    flp.address,
    flpManager.address,
    stakedFlpTracker.address,
    feeFlpTracker.address
  ])

  await deployContract("FlpBalance", [flpManager.address, stakedFlpTracker.address])
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
