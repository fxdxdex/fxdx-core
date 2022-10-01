const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function getValues() {
  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  const positionManager = await contractAt("PositionManager", addresses.positionManager)

  return { positionRouter, positionManager }
}

async function main() {
  const { positionRouter, positionManager } = await getValues()
  const referralStorage = await deployContract("ReferralStorage", [])
  // const referralStorage = await contractAt("ReferralStorage", await positionRouter.referralStorage())

  await sendTxn(positionRouter.setReferralStorage(referralStorage.address), "positionRouter.setReferralStorage")
  await sendTxn(positionManager.setReferralStorage(referralStorage.address), "positionManager.setReferralStorage")

  await sendTxn(referralStorage.setHandler(positionRouter.address, true), "referralStorage.setHandler(positionRouter)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
