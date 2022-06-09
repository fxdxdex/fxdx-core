const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');

const shouldSendTxn = true

async function getArbValues(signer) {
  const fxdxRewardTracker = await contractAt("RewardTracker", "0x908C4D94D34924765f1eDc22A1DD098397c59dD4")
  const flpRewardTracker = await contractAt("RewardTracker", "0x1aDDD80E6039594eE970E5872D247bf0414C8903")
  const tokenDecimals = 18
  const monthlyEsFxdxForFlp = expandDecimals(50 * 1000, 18)

  return { tokenDecimals, fxdxRewardTracker, flpRewardTracker, monthlyEsFxdxForFlp }
}

async function getAvaxValues(signer) {
  const fxdxRewardTracker = await contractAt("RewardTracker", "0x2bD10f8E93B3669b6d42E74eEedC65dd1B0a1342")
  const flpRewardTracker = await contractAt("RewardTracker", "0x9e295B5B976a184B14aD8cd72413aD846C299660")
  const tokenDecimals = 18
  const monthlyEsFxdxForFlp = expandDecimals(0, 18)

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
  const { tokenDecimals, fxdxRewardTracker, flpRewardTracker, monthlyEsFxdxForFlp } = await getValues()

  const stakedAmounts = {
    arbitrum: {
      fxdx: toInt("6,147,470"),
      esFxdx: toInt("1,277,087")
    },
    avax: {
      fxdx: toInt("417,802"),
      esFxdx: toInt("195,478")
    }
  }

  let totalStaked = 0
  for (const net in stakedAmounts) {
    stakedAmounts[net].total = stakedAmounts[net].fxdx + stakedAmounts[net].esFxdx
    totalStaked += stakedAmounts[net].total
  }

  const totalEsFxdxRewards = expandDecimals(100000, tokenDecimals)
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
    await sendTxn(fxdxRewardDistributor.setTokensPerInterval(fxdxNextTokensPerInterval), "fxdxRewardDistributor.setTokensPerInterval")
    await sendTxn(flpRewardDistributor.setTokensPerInterval(flpNextTokensPerInterval), "flpRewardDistributor.setTokensPerInterval")
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
