const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const wallet = { address: "0x5F799f365Fa8A2B60ac0429C48B153cA5a6f0Cf8" }

  const account = "0x6eA748d14f28778495A3fBa3550a6CdfBbE555f9"
  const unstakeAmount = "79170000000000000000"

  const rewardRouter = await contractAt("RewardRouter", "0x1b8911995ee36F4F95311D1D9C1845fA18c56Ec6")
  const fxdx = await contractAt("FXDX", "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a");
  const bnFxdx = await contractAt("MintableBaseToken", "0x35247165119B69A40edD5304969560D0ef486921");
  const stakedFxdxTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4")
  const bonusFxdxTracker = await contractAt("RewardTracker", "0x4d268a7d4C16ceB5a606c173Bd974984343fea13")
  const feeFxdxTracker = await contractAt("RewardTracker", "0xd2D1162512F927a7e282Ef43a362659E4F2a728F")

  // const gasLimit = 30000000

  // await sendTxn(feeFxdxTracker.setHandler(wallet.address, true, { gasLimit }), "feeFxdxTracker.setHandler")
  // await sendTxn(bonusFxdxTracker.setHandler(wallet.address, true, { gasLimit }), "bonusFxdxTracker.setHandler")
  // await sendTxn(stakedFxdxTracker.setHandler(wallet.address, true, { gasLimit }), "stakedFxdxTracker.setHandler")

  const stakedAmount = await stakedFxdxTracker.stakedAmounts(account)
  console.log(`${account} staked: ${stakedAmount.toString()}`)
  console.log(`unstakeAmount: ${unstakeAmount.toString()}`)

  await sendTxn(feeFxdxTracker.unstakeForAccount(account, bonusFxdxTracker.address, unstakeAmount, account), "feeFxdxTracker.unstakeForAccount")
  await sendTxn(bonusFxdxTracker.unstakeForAccount(account, stakedFxdxTracker.address, unstakeAmount, account), "bonusFxdxTracker.unstakeForAccount")
  await sendTxn(stakedFxdxTracker.unstakeForAccount(account, fxdx.address, unstakeAmount, account), "stakedFxdxTracker.unstakeForAccount")

  await sendTxn(bonusFxdxTracker.claimForAccount(account, account), "bonusFxdxTracker.claimForAccount")

  const bnFxdxAmount = await bnFxdx.balanceOf(account)
  console.log(`bnFxdxAmount: ${bnFxdxAmount.toString()}`)

  await sendTxn(feeFxdxTracker.stakeForAccount(account, account, bnFxdx.address, bnFxdxAmount), "feeFxdxTracker.stakeForAccount")

  const stakedBnFxdx = await feeFxdxTracker.depositBalances(account, bnFxdx.address)
  console.log(`stakedBnFxdx: ${stakedBnFxdx.toString()}`)

  const reductionAmount = stakedBnFxdx.mul(unstakeAmount).div(stakedAmount)
  console.log(`reductionAmount: ${reductionAmount.toString()}`)
  await sendTxn(feeFxdxTracker.unstakeForAccount(account, bnFxdx.address, reductionAmount, account), "feeFxdxTracker.unstakeForAccount")
  await sendTxn(bnFxdx.burn(account, reductionAmount), "bnFxdx.burn")

  const fxdxAmount = await fxdx.balanceOf(account)
  console.log(`fxdxAmount: ${fxdxAmount.toString()}`)

  await sendTxn(fxdx.burn(account, unstakeAmount), "fxdx.burn")
  const nextFxdxAmount = await fxdx.balanceOf(account)
  console.log(`nextFxdxAmount: ${nextFxdxAmount.toString()}`)

  const nextStakedAmount = await stakedFxdxTracker.stakedAmounts(account)
  console.log(`nextStakedAmount: ${nextStakedAmount.toString()}`)

  const nextStakedBnFxdx = await feeFxdxTracker.depositBalances(account, bnFxdx.address)
  console.log(`nextStakedBnFxdx: ${nextStakedBnFxdx.toString()}`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
