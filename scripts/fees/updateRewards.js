const { contractAt, sendTxn } = require("../shared/helpers")
const { bigNumberify, parseValue, expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const addresses = require('../core/addresses')[network];

const BASIS_POINTS_DIVISIOR = 10000

function getGoerliValues() {
  // replace the following two BPS values according to your need.
  // sum of the following two values should be equal to BASIS_POINTS_DIVISOR
  const FXDX_FEE_REWARDS_BPS = 3000 // 30%
  const FLP_FEE_REWARDS_BPS = 7000 // 70%

  // replace the following TOKEN_REWARDS_IN_USDC values with the rewards values got by running calculateFeeDistribution.js
  // you should swap the rewards tokens to USDC and use the result amount to fill in the values of TOKEN_REWARDS_IN_USDC
  // if you want to distribute rewards for some tokens, you can just set their values to "0"
  const TOKEN_REWARDS_IN_USDC = {
    btc: "0.01",
    eth: "0.01",
    usdc: "0.01",
    usdt: "0"
  }

  const TRADE_TOTAL_REBATE_USD = "0"
  const LIQUIDITY_TOTAL_REBATE_USD = "0"

  const decimals = tokens.usdc.decimals;

  let total = bigNumberify(0)

  for(let rewardAmount of Object.values(TOKEN_REWARDS_IN_USDC)) {
    total = total.add(parseValue(rewardAmount, decimals))
  }

  const rebatesInUsdc = (bigNumberify(TRADE_TOTAL_REBATE_USD).add(LIQUIDITY_TOTAL_REBATE_USD)).div(expandDecimals(1, 30 - decimals))

  total = total.sub(rebatesInUsdc)

  const fxdxFeeRewards = total.mul(FXDX_FEE_REWARDS_BPS).div(BASIS_POINTS_DIVISIOR)
  const flpFeeRewards = total.sub(fxdxFeeRewards)

  return { fxdxFeeRewards, flpFeeRewards }
}

function getOptimismGoerliValues() {
  // replace the following two BPS values according to your need.
  // sum of the following two values should be equal to BASIS_POINTS_DIVISOR
  const FXDX_FEE_REWARDS_BPS = 3000 // 30%
  const FLP_FEE_REWARDS_BPS = 7000 // 70%

  // replace the following TOKEN_REWARDS_IN_USDC values with the rewards values got by running calculateFeeDistribution.js
  // you should swap the rewards tokens to USDC and use the result amount to fill in the values of TOKEN_REWARDS_IN_USDC
  // if you want to distribute rewards for some tokens, you can just set their values to "0"
  const TOKEN_REWARDS_IN_USDC = {
    btc: "507187.467925758946167563",
    eth: "241559.148195611975721344",
    feth: "714348.479029965866324287",
    usdc: "738589.936675005001569977",
    usdt: "30733.621723729987575405"
  }

  const decimals = tokens.usdc.decimals;

  const TRADE_TOTAL_REBATE_USD = "561122140125703013240648836479523"
  const LIQUIDITY_TOTAL_REBATE_USD = "21848998712048872562678933119422"

  let total = bigNumberify(0)

  for(let rewardAmount of Object.values(TOKEN_REWARDS_IN_USDC)) {
    total = total.add(parseValue(rewardAmount, decimals))
  }

  const rebatesInUsdc = (bigNumberify(TRADE_TOTAL_REBATE_USD).add(LIQUIDITY_TOTAL_REBATE_USD)).div(expandDecimals(1, 30 - decimals))

  total = total.sub(rebatesInUsdc)
  const fxdxFeeRewards = total.mul(FXDX_FEE_REWARDS_BPS).div(BASIS_POINTS_DIVISIOR)
  const flpFeeRewards = total.sub(fxdxFeeRewards)

  return { fxdxFeeRewards, flpFeeRewards }
}

function getOptimismValues() {
  // replace the following two BPS values according to your need.
  // sum of the following two values should be equal to BASIS_POINTS_DIVISOR
  const FXDX_FEE_REWARDS_BPS = 0 // 30%
  const FLP_FEE_REWARDS_BPS = 10000 // 70%

  // replace the following TOKEN_REWARDS_IN_USDC values with the rewards values got by running calculateFeeDistribution.js
  // you should swap the rewards tokens to USDC and use the result amount to fill in the values of TOKEN_REWARDS_IN_USDC
  // if you want to distribute rewards for some tokens, you can just set their values to "0"
  const TOKEN_REWARDS_IN_USDC = {
    btc: "0",
    eth: "0",
    usdc: "261.564275",
    usdt: "0"
  }

  const TRADE_TOTAL_REBATE_USD = "0"
  const LIQUIDITY_TOTAL_REBATE_USD = "0"

  const decimals = tokens.usdc.decimals;

  let total = bigNumberify(0)

  for(let rewardAmount of Object.values(TOKEN_REWARDS_IN_USDC)) {
    total = total.add(parseValue(rewardAmount, decimals))
  }

  const rebatesInUsdc = (bigNumberify(TRADE_TOTAL_REBATE_USD).add(LIQUIDITY_TOTAL_REBATE_USD)).div(expandDecimals(1, 30 - decimals))

  total = total.sub(rebatesInUsdc)

  const fxdxFeeRewards = total.mul(FXDX_FEE_REWARDS_BPS).div(BASIS_POINTS_DIVISIOR)
  const flpFeeRewards = total.sub(fxdxFeeRewards)

  return { fxdxFeeRewards, flpFeeRewards }
}

function getValues() {
  if (network === "goerli") {
    return getGoerliValues()
  } else if (network === "optimismGoerli") {
    return getOptimismGoerliValues()
  } else if (network === "optimism") {
    return getOptimismValues()
  }

  // if (network === "avax") {
  //   return getAvaxValues(signer)
  // }
}

async function main() {
  const rewardToken = await contractAt("Token", tokens.usdc.address)

  const { fxdxFeeRewards, flpFeeRewards } = getValues()

  const rewardTrackerArr = [
    {
      name: "feeFxdxTracker",
      address: addresses.feeFxdxTracker,
      transferAmount: fxdxFeeRewards
    },
    {
      name: "feeFlpTracker",
      address: addresses.feeFlpTracker,
      transferAmount: flpFeeRewards
    }
  ]

  for (let i = 0; i < rewardTrackerArr.length; i++) {
    const rewardTrackerItem = rewardTrackerArr[i]
    const { transferAmount } = rewardTrackerItem
    const rewardTracker = await contractAt("RewardTracker", rewardTrackerItem.address)
    const rewardDistributorAddress = await rewardTracker.distributor()
    const rewardDistributor = await contractAt("RewardDistributor", rewardDistributorAddress)

    const rewardsPerInterval = transferAmount.div(7 * 24 * 60 * 60)

    console.log("-> rewardDistributorAddress:", rewardDistributorAddress)
    console.log("-> transferAmount          :", transferAmount.toString())
    console.log("-> rewardsPerInterval      :", rewardsPerInterval.toString())

    if (transferAmount.gt(0)) {
      await sendTxn(rewardToken.transfer(rewardDistributorAddress, transferAmount), `rewardToken.transfer ${i}`)
    }
    await sendTxn(rewardDistributor.setTokensPerInterval(rewardsPerInterval), "rewardDistributor.setTokensPerInterval")
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
