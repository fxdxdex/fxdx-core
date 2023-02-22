const { contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

async function main() {
  const rewardRouter = await contractAt("RewardRouterV2", addresses.rewardRouterV2)
  const flp = await contractAt("FLP", addresses.flp)
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  const bnFxdx = await contractAt("MintableBaseToken", addresses.bnFxdx)
  const flpManager = await contractAt("FlpManager", addresses.flpManager)

  const stakedFxdxTracker = await contractAt("RewardTracker", addresses.stakedFxdxTracker)
  const bonusFxdxTracker = await contractAt("RewardTracker", addresses.bonusFxdxTracker)
  const feeFxdxTracker = await contractAt("RewardTracker", addresses.feeFxdxTracker)

  const feeFlpTracker = await contractAt("RewardTracker", addresses.feeFlpTracker)
  const stakedFlpTracker = await contractAt("RewardTracker", addresses.stakedFlpTracker)

  const fxdxVester = await contractAt("Vester", addresses.fxdxVester)
  const flpVester = await contractAt("Vester", addresses.flpVester)

  await sendTxn(flpManager.setHandler(rewardRouter.address, false), "flpManager.setHandler(rewardRouter)")

  // allow rewardRouter to stake in stakedFxdxTracker
  await sendTxn(stakedFxdxTracker.setHandler(rewardRouter.address, false), "stakedFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in bonusFxdxTracker
  await sendTxn(bonusFxdxTracker.setHandler(rewardRouter.address, false), "bonusFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in feeFxdxTracker
  await sendTxn(feeFxdxTracker.setHandler(rewardRouter.address, false), "feeFxdxTracker.setHandler(rewardRouter)")
  // // allow feeFxdxTracker to stake bnFxdx
  // await sendTxn(bnFxdx.setHandler(feeFxdxTracker.address, false), "bnFxdx.setHandler(feeFxdxTracker")
  // allow rewardRouter to burn bnFxdx
  await sendTxn(bnFxdx.setMinter(rewardRouter.address, false), "bnFxdx.setMinter(rewardRouter")

  // // allow stakedFlpTracker to stake feeFlpTracker
  // await sendTxn(feeFlpTracker.setHandler(stakedFlpTracker.address, false), "feeFlpTracker.setHandler(stakedFlpTracker)")
  // // allow feeFlpTracker to stake flp
  // await sendTxn(flp.setHandler(feeFlpTracker.address, false), "flp.setHandler(feeFlpTracker)")

  // allow rewardRouter to stake in feeFlpTracker
  await sendTxn(feeFlpTracker.setHandler(rewardRouter.address, false), "feeFlpTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in stakedFlpTracker
  await sendTxn(stakedFlpTracker.setHandler(rewardRouter.address, false), "stakedFlpTracker.setHandler(rewardRouter)")

  await sendTxn(esFxdx.setHandler(rewardRouter.address, false), "esFxdx.setHandler(rewardRouter)")

  await sendTxn(fxdxVester.setHandler(rewardRouter.address, false), "fxdxVester.setHandler(rewardRouter)")
  await sendTxn(flpVester.setHandler(rewardRouter.address, false), "flpVester.setHandler(rewardRouter)")

  // await sendTxn(feeFxdxTracker.setHandler(fxdxVester.address, false), "feeFxdxTracker.setHandler(fxdxVester)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
