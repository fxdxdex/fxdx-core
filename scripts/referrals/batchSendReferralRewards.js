const path = require("path")

const { expandDecimals } = require("../../test/shared/utilities")
const { getOptimismGoerliValues, getOptimismValues, sendReferralRewards } = require("./referralRewards")

const fxdxPrice = expandDecimals("5", 29)

const feeRewardTokenPrice = expandDecimals(1, 30)

const shouldSendTxn = true

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const feeRewardToken = tokens.usdc

async function getValues() {
  if (network === "optimismGoerli") {
    return getOptimismGoerliValues()
  }

  if (network === "optimism") {
    return getOptimismValues()
  }
}

async function main() {
  const values = await getValues()
  await sendReferralRewards({ shouldSendTxn, feeRewardToken, feeRewardTokenPrice, fxdxPrice, values })
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
