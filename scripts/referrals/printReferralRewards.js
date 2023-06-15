const { bigNumberify } = require("../../test/shared/utilities")
const { getOptimismGoerliValues, getOptimismValues, getReferralRewardsInfo } = require("./getReferralRewards")

async function getNetworkValues() {
  return [
    await getOptimismGoerliValues(),
    await getOptimismValues()
  ]
}

async function main() {
  const values = await getNetworkValues()

  let totalReferrerUsd = bigNumberify(0)
  let totalLiquidityReferrerUsd = bigNumberify(0)
  let totalDiscountUsd = bigNumberify(0)

  for (let i = 0; i < values.length; i++) {
    const { data } = values[i]
    const rewardsInfo = getReferralRewardsInfo(data)
    totalReferrerUsd = totalReferrerUsd.add(rewardsInfo.allReferrerUsd)
    totalLiquidityReferrerUsd = totalLiquidityReferrerUsd.add(rewardsInfo.allLiquidityReferrerUsd)
    totalDiscountUsd = totalDiscountUsd.add(rewardsInfo.allDiscountUsd)
  }

  console.log("Trader Discounts:", ethers.utils.formatUnits(totalDiscountUsd, 30))
  console.log("Referrer Trades Rebates:", ethers.utils.formatUnits(totalReferrerUsd, 30))
  console.log("Referrer BuyFLP Rebates:", ethers.utils.formatUnits(totalLiquidityReferrerUsd, 30))
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
