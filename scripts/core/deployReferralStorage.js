const { deployContract, contractAt , sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('./addresses')[network];

async function main() {
  const positionRouter = await contractAt("PositionRouter", addresses.positionRouter)
  const positionManager = await contractAt("PositionManager", addresses.positionManager)
  const liquidityRouter = await contractAt("LiquidityRouter", addresses.liquidityRouter)
  const referralStorage = await deployContract("ReferralStorage", [])
  // const referralStorage = await contractAt("ReferralStorage", addresses.referralStorage)

  await sendTxn(positionRouter.setReferralStorage(referralStorage.address), "positionRouter.setReferralStorage")
  await sendTxn(positionManager.setReferralStorage(referralStorage.address), "positionManager.setReferralStorage")
  await sendTxn(liquidityRouter.setReferralStorage(referralStorage.address), "liquidityRouter.setReferralStorage")

  await sendTxn(referralStorage.setHandler(positionRouter.address, true), "referralStorage.setHandler(positionRouter)")
  await sendTxn(referralStorage.setHandler(liquidityRouter.address, true), "referralStorage.setHandler(liquidityRouter)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
