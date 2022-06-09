const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const wallet = { address: "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8" }
  const { AddressZero } = ethers.constants

  const weth = { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" }
  const fxdx = await deployContract("FXDX", []);
  const esFxdx = await deployContract("EsFXDX", []);
  const bnFxdx = await deployContract("MintableBaseToken", ["Bonus FXDX", "bnFXDX", 0]);
  const bnAlp = { address: AddressZero }
  const alp = { address: AddressZero }

  const stakedFxdxTracker = await deployContract("RewardTracker", ["Staked FXDX", "sFXDX"])
  const stakedFxdxDistributor = await deployContract("RewardDistributor", [esFxdx.address, stakedFxdxTracker.address])
  await sendTxn(stakedFxdxTracker.initialize([fxdx.address, esFxdx.address], stakedFxdxDistributor.address), "stakedFxdxTracker.initialize")
  await sendTxn(stakedFxdxDistributor.updateLastDistributionTime(), "stakedFxdxDistributor.updateLastDistributionTime")

  const bonusFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus FXDX", "sbFXDX"])
  const bonusFxdxDistributor = await deployContract("BonusDistributor", [bnFxdx.address, bonusFxdxTracker.address])
  await sendTxn(bonusFxdxTracker.initialize([stakedFxdxTracker.address], bonusFxdxDistributor.address), "bonusFxdxTracker.initialize")
  await sendTxn(bonusFxdxDistributor.updateLastDistributionTime(), "bonusFxdxDistributor.updateLastDistributionTime")

  const feeFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee FXDX", "sbfFXDX"])
  const feeFxdxDistributor = await deployContract("RewardDistributor", [weth.address, feeFxdxTracker.address])
  await sendTxn(feeFxdxTracker.initialize([bonusFxdxTracker.address, bnFxdx.address], feeFxdxDistributor.address), "feeFxdxTracker.initialize")
  await sendTxn(feeFxdxDistributor.updateLastDistributionTime(), "feeFxdxDistributor.updateLastDistributionTime")

  const feeFlpTracker = { address: AddressZero }
  const stakedFlpTracker = { address: AddressZero }

  const stakedAlpTracker = { address: AddressZero }
  const bonusAlpTracker = { address: AddressZero }
  const feeAlpTracker = { address: AddressZero }

  const flpManager = { address: AddressZero }
  const flp = { address: AddressZero }

  await sendTxn(stakedFxdxTracker.setInPrivateTransferMode(true), "stakedFxdxTracker.setInPrivateTransferMode")
  await sendTxn(stakedFxdxTracker.setInPrivateStakingMode(true), "stakedFxdxTracker.setInPrivateStakingMode")
  await sendTxn(bonusFxdxTracker.setInPrivateTransferMode(true), "bonusFxdxTracker.setInPrivateTransferMode")
  await sendTxn(bonusFxdxTracker.setInPrivateStakingMode(true), "bonusFxdxTracker.setInPrivateStakingMode")
  await sendTxn(bonusFxdxTracker.setInPrivateClaimingMode(true), "bonusFxdxTracker.setInPrivateClaimingMode")
  await sendTxn(feeFxdxTracker.setInPrivateTransferMode(true), "feeFxdxTracker.setInPrivateTransferMode")
  await sendTxn(feeFxdxTracker.setInPrivateStakingMode(true), "feeFxdxTracker.setInPrivateStakingMode")

  const rewardRouter = await deployContract("RewardRouter", [])

  await sendTxn(rewardRouter.initialize(
    fxdx.address,
    esFxdx.address,
    bnFxdx.address,
    bnAlp.address,
    flp.address,
    alp.address,
    stakedFxdxTracker.address,
    bonusFxdxTracker.address,
    feeFxdxTracker.address,
    feeFlpTracker.address,
    stakedFlpTracker.address,
    stakedAlpTracker.address,
    bonusAlpTracker.address,
    feeAlpTracker.address,
    flpManager.address
  ), "rewardRouter.initialize")

  // allow rewardRouter to stake in stakedFxdxTracker
  await sendTxn(stakedFxdxTracker.setHandler(rewardRouter.address, true), "stakedFxdxTracker.setHandler(rewardRouter)")
  // allow bonusFxdxTracker to stake stakedFxdxTracker
  await sendTxn(stakedFxdxTracker.setHandler(bonusFxdxTracker.address, true), "stakedFxdxTracker.setHandler(bonusFxdxTracker)")
  // allow rewardRouter to stake in bonusFxdxTracker
  await sendTxn(bonusFxdxTracker.setHandler(rewardRouter.address, true), "bonusFxdxTracker.setHandler(rewardRouter)")
  // allow bonusFxdxTracker to stake feeFxdxTracker
  await sendTxn(bonusFxdxTracker.setHandler(feeFxdxTracker.address, true), "bonusFxdxTracker.setHandler(feeFxdxTracker)")
  await sendTxn(bonusFxdxDistributor.setBonusMultiplier(10000), "bonusFxdxDistributor.setBonusMultiplier")
  // allow rewardRouter to stake in feeFxdxTracker
  await sendTxn(feeFxdxTracker.setHandler(rewardRouter.address, true), "feeFxdxTracker.setHandler(rewardRouter)")
  // allow stakedFxdxTracker to stake esFxdx
  await sendTxn(esFxdx.setHandler(stakedFxdxTracker.address, true), "esFxdx.setHandler(stakedFxdxTracker)")
  // allow feeFxdxTracker to stake bnFxdx
  await sendTxn(bnFxdx.setHandler(feeFxdxTracker.address, true), "bnFxdx.setHandler(feeFxdxTracker")
  // allow rewardRouter to burn bnFxdx
  await sendTxn(bnFxdx.setMinter(rewardRouter.address, true), "bnFxdx.setMinter(rewardRouter")

  // mint esFxdx for distributors
  await sendTxn(esFxdx.setMinter(wallet.address, true), "esFxdx.setMinter(wallet)")
  await sendTxn(esFxdx.mint(stakedFxdxDistributor.address, expandDecimals(50000 * 12, 18)), "esFxdx.mint(stakedFxdxDistributor") // ~50,000 FXDX per month
  await sendTxn(stakedFxdxDistributor.setTokensPerInterval("20667989410000000"), "stakedFxdxDistributor.setTokensPerInterval") // 0.02066798941 esFxdx per second

  // mint bnFxdx for distributor
  await sendTxn(bnFxdx.setMinter(wallet.address, true), "bnFxdx.setMinter")
  await sendTxn(bnFxdx.mint(bonusFxdxDistributor.address, expandDecimals(15 * 1000 * 1000, 18)), "bnFxdx.mint(bonusFxdxDistributor)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
