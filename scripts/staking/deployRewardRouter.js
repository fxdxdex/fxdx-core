const { deployContract, contractAt, sendTxn, readTmpAddresses } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];

async function main() {
  const {
    nativeToken
  } = tokens

  const weth = await contractAt("Token", nativeToken.address)
  const fxdx = await contractAt("FXDX", "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a")
  const esFxdx = await contractAt("EsFXDX", "0xf42Ae1D54fd613C9bb14810b0588FaAa09a426cA")
  const bnFxdx = await contractAt("MintableBaseToken", "0x35247165119B69A40edD5304969560D0ef486921")

  const stakedFxdxTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4")
  const bonusFxdxTracker = await contractAt("RewardTracker", "0x4d268a7d4C16ceB5a606c173Bd974984343fea13")
  const feeFxdxTracker = await contractAt("RewardTracker", "0xd2D1162512F927a7e282Ef43a362659E4F2a728F")

  const feeFlpTracker = await contractAt("RewardTracker", "0x4e971a87900b931fF39d1Aad67697F49835400b6")
  const stakedFlpTracker = await contractAt("RewardTracker", "0x1aDDD80E6039594eE970E5872D247bf0414C8903")

  const flp = await contractAt("FLP", "0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258")
  const flpManager = await contractAt("FlpManager", "0x321F653eED006AD1C29D174e17d96351BDe22649")

  console.log("flpManager", flpManager.address)

  const rewardRouter = await deployContract("RewardRouter", [])

  await sendTxn(rewardRouter.initialize(
    weth.address,
    fxdx.address,
    esFxdx.address,
    bnFxdx.address,
    flp.address,
    stakedFxdxTracker.address,
    bonusFxdxTracker.address,
    feeFxdxTracker.address,
    feeFlpTracker.address,
    stakedFlpTracker.address,
    flpManager.address
  ), "rewardRouter.initialize")

  // allow rewardRouter to stake in stakedFxdxTracker
  await sendTxn(stakedFxdxTracker.setHandler(rewardRouter.address, true), "stakedFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in bonusFxdxTracker
  await sendTxn(bonusFxdxTracker.setHandler(rewardRouter.address, true), "bonusFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in feeFxdxTracker
  await sendTxn(feeFxdxTracker.setHandler(rewardRouter.address, true), "feeFxdxTracker.setHandler(rewardRouter)")
  // allow rewardRouter to burn bnFxdx
  await sendTxn(bnFxdx.setMinter(rewardRouter.address, true), "bnFxdx.setMinter(rewardRouter)")

  // allow rewardRouter to mint in flpManager
  await sendTxn(flpManager.setHandler(rewardRouter.address, true), "flpManager.setHandler(rewardRouter)")
  // allow rewardRouter to stake in feeFlpTracker
  await sendTxn(feeFlpTracker.setHandler(rewardRouter.address, true), "feeFlpTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in stakedFlpTracker
  await sendTxn(stakedFlpTracker.setHandler(rewardRouter.address, true), "stakedFlpTracker.setHandler(rewardRouter)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
