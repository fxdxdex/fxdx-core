const { deployContract, contractAt, sendTxn, signers } = require("../shared/helpers")
const { expandDecimals, bigNumberify } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const shouldSendTxn = true

const monthlyEsFxdxForFlpOnArb = expandDecimals(toInt("0"), 18)
const monthlyEsFxdxForFlpOnAvax = expandDecimals(toInt("0"), 18)

async function getStakedAmounts() {
  const arbStakedFxdxTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4", signers.arbitrum)
  const arbStakedFxdxAndEsFxdx =await arbStakedFxdxTracker.totalSupply()

  const avaxStakedFxdxTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4", signers.avax)
  const avaxStakedFxdxAndEsFxdx =await avaxStakedFxdxTracker.totalSupply()

  return {
    arbStakedFxdxAndEsFxdx,
    avaxStakedFxdxAndEsFxdx
  }
}

async function getArbValues() {
  const fxdxRewardTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4")
  const flpRewardTracker = await contractAt("RewardTracker", "0x1aDDD80E6039594eE970E5872D247bf0414C8903")
  const tokenDecimals = 18
  const monthlyEsFxdxForFlp = monthlyEsFxdxForFlpOnArb

  return { tokenDecimals, fxdxRewardTracker, flpRewardTracker, monthlyEsFxdxForFlp }
}

async function getAvaxValues() {
  const fxdxRewardTracker = await contractAt("RewardTracker", "0x2bD10f8E93B3669b6d42E74eEedC65dd1B0a1342")
  const flpRewardTracker = await contractAt("RewardTracker", "0x9e295B5B976a184B14aD8cd72413aD846C299660")
  const tokenDecimals = 18
  const monthlyEsFxdxForFlp = monthlyEsFxdxForFlpOnAvax

  return { tokenDecimals, fxdxRewardTracker, flpRewardTracker, monthlyEsFxdxForFlp }
}

function getValues() {
  if (network === "arbitrum") {
    return getArbValues()
  }

  if (network === "avax") {
    return getAvaxValues()
  }
}

function toInt(value) {
  return parseInt(value.replaceAll(",", ""))
}

async function main() {
  const { arbStakedFxdxAndEsFxdx, avaxStakedFxdxAndEsFxdx } = await getStakedAmounts()
  const { tokenDecimals, fxdxRewardTracker, flpRewardTracker, monthlyEsFxdxForFlp } = await getValues()

  const stakedAmounts = {
    arbitrum: {
      total: arbStakedFxdxAndEsFxdx
    },
    avax: {
      total: avaxStakedFxdxAndEsFxdx
    }
  }

  let totalStaked = bigNumberify(0)

  for (const net in stakedAmounts) {
    totalStaked = totalStaked.add(stakedAmounts[net].total)
  }

  const totalEsFxdxRewards = expandDecimals(50000, tokenDecimals)
  const secondsPerMonth = 28 * 24 * 60 * 60

  const fxdxRewardDistributor = await contractAt("RewardDistributor", await fxdxRewardTracker.distributor())

  const fxdxCurrentTokensPerInterval = await fxdxRewardDistributor.tokensPerInterval()
  const fxdxNextTokensPerInterval = totalEsFxdxRewards.mul(stakedAmounts[network].total).div(totalStaked).div(secondsPerMonth)
  const fxdxDelta = fxdxNextTokensPerInterval.sub(fxdxCurrentTokensPerInterval).mul(10000).div(fxdxCurrentTokensPerInterval)

  console.log("fxdxCurrentTokensPerInterval", fxdxCurrentTokensPerInterval.toString())
  console.log("fxdxNextTokensPerInterval", fxdxNextTokensPerInterval.toString(), `${fxdxDelta.toNumber() / 100.00}%`)

  const flpRewardDistributor = await contractAt("RewardDistributor", await flpRewardTracker.distributor())

  const flpCurrentTokensPerInterval = await flpRewardDistributor.tokensPerInterval()
  const flpNextTokensPerInterval = monthlyEsFxdxForFlp.div(secondsPerMonth)

  console.log("flpCurrentTokensPerInterval", flpCurrentTokensPerInterval.toString())
  console.log("flpNextTokensPerInterval", flpNextTokensPerInterval.toString())

  if (shouldSendTxn) {
    await sendTxn(fxdxRewardDistributor.setTokensPerInterval(fxdxNextTokensPerInterval, { gasLimit: 500000 }), "fxdxRewardDistributor.setTokensPerInterval")
    await sendTxn(flpRewardDistributor.setTokensPerInterval(flpNextTokensPerInterval, { gasLimit: 500000 }), "flpRewardDistributor.setTokensPerInterval")
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
