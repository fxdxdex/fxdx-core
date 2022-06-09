const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const rewardRouter = await contractAt("RewardRouter", "0xEa7fCb85802713Cb03291311C66d6012b23402ea")
  const bnFxdx = await contractAt("MintableBaseToken", "0x35247165119B69A40edD5304969560D0ef486921")
  const flpManager = await contractAt("FlpManager", "0x91425Ac4431d068980d497924DD540Ae274f3270")

  const stakedFxdxTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4")
  const bonusFxdxTracker = await contractAt("RewardTracker", "0x4d268a7d4C16ceB5a606c173Bd974984343fea13")
  const feeFxdxTracker = await contractAt("RewardTracker", "0xd2D1162512F927a7e282Ef43a362659E4F2a728F")

  const feeFlpTracker = await contractAt("RewardTracker", "0x4e971a87900b931fF39d1Aad67697F49835400b6")
  const stakedFlpTracker = await contractAt("RewardTracker", "0x1aDDD80E6039594eE970E5872D247bf0414C8903")

  // allow rewardRouter to stake in stakedFxdxTracker
  await sendTxn(stakedFxdxTracker.setHandler(rewardRouter.address, false), "stakedFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in bonusFxdxTracker
  await sendTxn(bonusFxdxTracker.setHandler(rewardRouter.address, false), "bonusFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in feeFxdxTracker
  await sendTxn(feeFxdxTracker.setHandler(rewardRouter.address, false), "feeFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to burn bnFxdx
  await sendTxn(bnFxdx.setMinter(rewardRouter.address, false), "bnFxdx.setMinter(rewardRouter)")

  // allow rewardRouter to mint in flpManager
  await sendTxn(flpManager.setHandler(rewardRouter.address, false), "flpManager.setHandler(rewardRouter)")
  // allow rewardRouter to stake in feeFlpTracker
  await sendTxn(feeFlpTracker.setHandler(rewardRouter.address, false), "feeFlpTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in stakedFlpTracker
  await sendTxn(stakedFlpTracker.setHandler(rewardRouter.address, false), "stakedFlpTracker.setHandler(rewardRouter)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
