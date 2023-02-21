const { deployContract, contractAt, sendTxn } = require("../shared/helpers")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const addresses = require('../core/addresses')[network];

async function main() {
  const { nativeToken, usdc } = tokens

  const vestingDuration = 365 * 24 * 60 * 60

  const vault = await contractAt("Vault", addresses.vault)
  const flpManager = await contractAt("FlpManager", addresses.flpManager)
  const flp = await contractAt("FLP", addresses.flp)

  const fxdx = await contractAt("FXDX", addresses.fxdx);
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx);
  const bnFxdx = await deployContract("MintableBaseToken", ["Bonus FXDX", "bnFXDX", 0]);

  // const bnFxdx = await contractAt("MintableBaseToken", addresses.bnFxdx)

  await sendTxn(esFxdx.setInPrivateTransferMode(true), "esFxdx.setInPrivateTransferMode")
  await sendTxn(flp.setInPrivateTransferMode(true), "flp.setInPrivateTransferMode")

  const stakedFxdxTracker = await deployContract("RewardTracker", ["Staked FXDX", "sFXDX"])
  const stakedFxdxDistributor = await deployContract("RewardDistributor", [esFxdx.address, stakedFxdxTracker.address])
  await sendTxn(stakedFxdxTracker.initialize([fxdx.address, esFxdx.address], stakedFxdxDistributor.address), "stakedFxdxTracker.initialize")
  await sendTxn(stakedFxdxDistributor.updateLastDistributionTime(), "stakedFxdxDistributor.updateLastDistributionTime")

  // const stakedFxdxTracker = await contractAt("RewardTracker", addresses.stakedFxdxTracker)
  // const stakedFxdxDistributor = await contractAt("RewardDistributor", addresses.stakedFxdxDistributor)

  const bonusFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus FXDX", "sbFXDX"])
  const bonusFxdxDistributor = await deployContract("BonusDistributor", [bnFxdx.address, bonusFxdxTracker.address])
  await sendTxn(bonusFxdxTracker.initialize([stakedFxdxTracker.address], bonusFxdxDistributor.address), "bonusFxdxTracker.initialize")
  await sendTxn(bonusFxdxDistributor.updateLastDistributionTime(), "bonusFxdxDistributor.updateLastDistributionTime")

  // const bonusFxdxTracker = await contractAt("RewardTracker", addresses.bonusFxdxTracker)
  // const bonusFxdxDistributor = await contractAt("BonusDistributor", addresses.bonusFxdxDistributor)

  const feeFxdxTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee FXDX", "sbfFXDX"])
  const feeFxdxDistributor = await deployContract("RewardDistributor", [usdc.address, feeFxdxTracker.address])
  await sendTxn(feeFxdxTracker.initialize([bonusFxdxTracker.address, bnFxdx.address], feeFxdxDistributor.address), "feeFxdxTracker.initialize")
  await sendTxn(feeFxdxDistributor.updateLastDistributionTime(), "feeFxdxDistributor.updateLastDistributionTime")

  // const feeFxdxTracker = await contractAt("RewardTracker", addresses.feeFxdxTracker)
  // const feeFxdxDistributor = await contractAt("RewardDistributor", addresses.feeFxdxDistributor)

  const feeFlpTracker = await deployContract("RewardTracker", ["Fee FLP", "fFLP"])
  const feeFlpDistributor = await deployContract("RewardDistributor", [usdc.address, feeFlpTracker.address])
  await sendTxn(feeFlpTracker.initialize([flp.address], feeFlpDistributor.address), "feeFlpTracker.initialize")
  await sendTxn(feeFlpDistributor.updateLastDistributionTime(), "feeFlpDistributor.updateLastDistributionTime")

  // const feeFlpTracker = await contractAt("RewardTracker", addresses.feeFlpTracker)
  // const feeFlpDistributor = await contractAt("RewardDistributor", addresses.feeFlpDistributor)

  const stakedFlpTracker = await deployContract("RewardTracker", ["Fee + Staked FLP", "fsFLP"])
  const stakedFlpDistributor = await deployContract("RewardDistributor", [esFxdx.address, stakedFlpTracker.address])
  await sendTxn(stakedFlpTracker.initialize([feeFlpTracker.address], stakedFlpDistributor.address), "stakedFlpTracker.initialize")
  await sendTxn(stakedFlpDistributor.updateLastDistributionTime(), "stakedFlpDistributor.updateLastDistributionTime")

  // const stakedFlpTracker = await contractAt("RewardTracker", addresses.stakedFlpTracker)
  // await sendTxn(stakedFlpTracker.setDepositToken(addresses.feeFlpTracker, false), "stakedFlpTracker.setDepositToken")
  // await sendTxn(stakedFlpTracker.setDepositToken(feeFlpTracker.address, true), "stakedFlpTracker.setDepositToken")
  // const stakedFlpDistributor = await contractAt("RewardDistributor", addresses.stakedFlpDistributor)

  await sendTxn(stakedFxdxTracker.setInPrivateTransferMode(true), "stakedFxdxTracker.setInPrivateTransferMode")
  await sendTxn(stakedFxdxTracker.setInPrivateStakingMode(true), "stakedFxdxTracker.setInPrivateStakingMode")
  await sendTxn(bonusFxdxTracker.setInPrivateTransferMode(true), "bonusFxdxTracker.setInPrivateTransferMode")
  await sendTxn(bonusFxdxTracker.setInPrivateStakingMode(true), "bonusFxdxTracker.setInPrivateStakingMode")
  await sendTxn(bonusFxdxTracker.setInPrivateClaimingMode(true), "bonusFxdxTracker.setInPrivateClaimingMode")
  await sendTxn(feeFxdxTracker.setInPrivateTransferMode(true), "feeFxdxTracker.setInPrivateTransferMode")
  await sendTxn(feeFxdxTracker.setInPrivateStakingMode(true), "feeFxdxTracker.setInPrivateStakingMode")

  await sendTxn(feeFlpTracker.setInPrivateTransferMode(true), "feeFlpTracker.setInPrivateTransferMode")
  await sendTxn(feeFlpTracker.setInPrivateStakingMode(true), "feeFlpTracker.setInPrivateStakingMode")
  await sendTxn(stakedFlpTracker.setInPrivateTransferMode(true), "stakedFlpTracker.setInPrivateTransferMode")
  await sendTxn(stakedFlpTracker.setInPrivateStakingMode(true), "stakedFlpTracker.setInPrivateStakingMode")

  const fxdxVester = await deployContract("Vester", [
    "Vested FXDX", // _name
    "vFXDX", // _symbol
    vestingDuration, // _vestingDuration
    esFxdx.address, // _esToken
    feeFxdxTracker.address, // _pairToken
    fxdx.address, // _claimableToken
    stakedFxdxTracker.address, // _rewardTracker
  ])

  const flpVester = await deployContract("Vester", [
    "Vested FLP", // _name
    "vFLP", // _symbol
    vestingDuration, // _vestingDuration
    esFxdx.address, // _esToken
    stakedFlpTracker.address, // _pairToken
    fxdx.address, // _claimableToken
    stakedFlpTracker.address, // _rewardTracker
  ])

  // const fxdxVester = await contractAt("Vester", addresses.fxdxVester)
  // const flpVester = await contractAt("Vester", addresses.flpVester)

  const rewardRouter = await deployContract("RewardRouterV2", [])
  await sendTxn(rewardRouter.initialize(
    vault.address,
    nativeToken.address,
    fxdx.address,
    esFxdx.address,
    bnFxdx.address,
    flp.address,
    stakedFxdxTracker.address,
    bonusFxdxTracker.address,
    feeFxdxTracker.address,
    feeFlpTracker.address,
    stakedFlpTracker.address,
    flpManager.address,
    fxdxVester.address,
    flpVester.address
  ), "rewardRouter.initialize")

  // const rewardRouter = await contractAt("RewardRouterV2", addresses.rewardRouterV2)

  await sendTxn(flpManager.setHandler(rewardRouter.address, true), "flpManager.setHandler(rewardRouter)")

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

  // allow stakedFlpTracker to stake feeFlpTracker
  await sendTxn(feeFlpTracker.setHandler(stakedFlpTracker.address, true), "feeFlpTracker.setHandler(stakedFlpTracker)")
  // allow feeFlpTracker to stake flp
  await sendTxn(flp.setHandler(feeFlpTracker.address, true), "flp.setHandler(feeFlpTracker)")

  // allow rewardRouter to stake in feeFlpTracker
  await sendTxn(feeFlpTracker.setHandler(rewardRouter.address, true), "feeFlpTracker.setHandler(rewardRouter)")
  // allow rewardRouter to stake in stakedFlpTracker
  await sendTxn(stakedFlpTracker.setHandler(rewardRouter.address, true), "stakedFlpTracker.setHandler(rewardRouter)")

  await sendTxn(esFxdx.setHandler(rewardRouter.address, true), "esFxdx.setHandler(rewardRouter)")
  await sendTxn(esFxdx.setHandler(stakedFxdxDistributor.address, true), "esFxdx.setHandler(stakedFxdxDistributor)")
  await sendTxn(esFxdx.setHandler(stakedFlpDistributor.address, true), "esFxdx.setHandler(stakedFlpDistributor)")
  await sendTxn(esFxdx.setHandler(stakedFlpTracker.address, true), "esFxdx.setHandler(stakedFlpTracker)")
  await sendTxn(esFxdx.setHandler(fxdxVester.address, true), "esFxdx.setHandler(fxdxVester)")
  await sendTxn(esFxdx.setHandler(flpVester.address, true), "esFxdx.setHandler(flpVester)")

  await sendTxn(esFxdx.setMinter(fxdxVester.address, true), "esFxdx.setMinter(fxdxVester)")
  await sendTxn(esFxdx.setMinter(flpVester.address, true), "esFxdx.setMinter(flpVester)")

  await sendTxn(fxdxVester.setHandler(rewardRouter.address, true), "fxdxVester.setHandler(rewardRouter)")
  await sendTxn(flpVester.setHandler(rewardRouter.address, true), "flpVester.setHandler(rewardRouter)")

  await sendTxn(feeFxdxTracker.setHandler(fxdxVester.address, true), "feeFxdxTracker.setHandler(fxdxVester)")
  await sendTxn(stakedFlpTracker.setHandler(flpVester.address, true), "stakedFlpTracker.setHandler(flpVester)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
