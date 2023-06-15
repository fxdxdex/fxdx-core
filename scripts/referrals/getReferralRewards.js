const path = require("path")

const { bigNumberify } = require("../../test/shared/utilities")

async function getOptimismGoerliValues() {
  let optimismGoerliFile
  if (process.env.OPTIMISM_GOERLI_FILE) {
    optimismGoerliFile = path.join(process.env.PWD, process.env.OPTIMISM_GOERLI_FILE)
  } else {
    optimismGoerliFile = path.join(__dirname, "../../distribution-data-optimismGoerli.json")
  }
  console.log("Optimism Goerli file: %s", optimismGoerliFile)
  const optimismGoerliData = require(optimismGoerliFile)

  return { data: optimismGoerliData }
}

async function getOptimismValues() {
  let optimismFile
  if (process.env.OPTIMISM_FILE) {
    optimismFile = path.join(process.env.PWD, process.env.OPTIMISM_FILE)
  } else {
    optimismFile = path.join(__dirname, "../../distribution-data-optimism.json")
  }
  console.log("Optimism file: %s", optimismFile)
  const optimismData = require(optimismFile)

  return { data: optimismData }
}

async function getNetworkValues() {
  return [
    await getOptimismGoerliValues(),
    await getOptimismValues()
  ]
}

function getReferralRewardsInfo(data) {
  console.log("data", data)
  const referrersData = data.referrers
  const discountsData = data.referrals

  console.log("referrers", referrersData.length)
  console.log("trader discounts", discountsData.length)

  let allReferrerUsd = bigNumberify(0)
  let allLiquidityReferrerUsd = bigNumberify(0)
  let allDiscountUsd = bigNumberify(0)

  for (let i = 0; i < referrersData.length; i++) {
    const { rebateUsd, liquidityTotalRebateUsd } = referrersData[i]
    allReferrerUsd = allReferrerUsd.add(rebateUsd)
    allLiquidityReferrerUsd = allLiquidityReferrerUsd.add(liquidityTotalRebateUsd)
  }

  for (let i = 0; i < discountsData.length; i++) {
    const { discountUsd } = discountsData[i]
    allDiscountUsd = allDiscountUsd.add(discountUsd)
  }

  console.log("all referrer trades rebates (USD)", ethers.utils.formatUnits(allReferrerUsd, 30))
  console.log("all referrer buyFLP rebates (USD)", ethers.utils.formatUnits(allLiquidityReferrerUsd, 30))
  console.log("all trader discounts (USD)", ethers.utils.formatUnits(allDiscountUsd, 30))

  return {
    allReferrerUsd,
    allLiquidityReferrerUsd,
    allDiscountUsd
  }
}

module.exports = {
  getOptimismGoerliValues,
  getOptimismValues,
  getReferralRewardsInfo
}
