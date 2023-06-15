const path = require("path")

const { contractAt, sendTxn, processBatch } = require("../shared/helpers")
const { expandDecimals, bigNumberify } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require('../core/addresses')[network];

const { AddressZero } = ethers.constants

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

async function sendReferralRewards({ shouldSendTxn, feeRewardToken, feeRewardTokenPrice, fxdxPrice, values }) {
  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  const esFxdx = await contractAt("EsFXDX", addresses.esFxdx)
  const { data } = values

  const referrersData = data.referrers
  const discountsData = data.referrals

  console.log("referrers rebates:", referrersData.length)
  console.log("trader discounts:", discountsData.length)

  const referrerRewardsTypeId = 1
  const traderDiscountsTypeId = 2
  const liquidityRefererRewardsTypeId = 3

  let totalReferrerAmount = bigNumberify(0)
  let totalReferrerUsd = bigNumberify(0)
  let allReferrerUsd = bigNumberify(0)
  let totalDiscountAmount = bigNumberify(0)
  let totalDiscountUsd = bigNumberify(0)
  let allDiscountUsd = bigNumberify(0)
  let totalLiquidityReferrerAmount = bigNumberify(0)
  let totalLiquidityReferrerUsd = bigNumberify(0)
  let allLiquidityReferrerUsd = bigNumberify(0)
  let totalEsFxdxAmount = bigNumberify(0)
  const referrerAccounts = []
  const referrerAmounts = []
  const discountAccounts = []
  const discountAmounts = []
  const esFxdxAccounts = []
  const esFxdxAmounts = []
  const liquidityReferrerAccounts = []
  const liquidityReferrerAmounts = []

  for (let i = 0; i < referrersData.length; i++) {
    const { account, rebateUsd, liquidityTotalRebateUsd, esfxdxRewardsUsd } = referrersData[i]
    allReferrerUsd = allReferrerUsd.add(rebateUsd)
    allLiquidityReferrerUsd = allLiquidityReferrerUsd.add(liquidityTotalRebateUsd)

    if (account === AddressZero) { continue }

    if (rebateUsd && bigNumberify(rebateUsd).gt(0)) {
      const amount = bigNumberify(rebateUsd).mul(expandDecimals(1, feeRewardToken.decimals)).div(feeRewardTokenPrice)
      referrerAccounts.push(account)
      referrerAmounts.push(amount)
      totalReferrerAmount = totalReferrerAmount.add(amount)
      totalReferrerUsd = totalReferrerUsd.add(rebateUsd)
    }

    if (liquidityTotalRebateUsd && bigNumberify(liquidityTotalRebateUsd).gt(0)) {
      const liquidityAmount = bigNumberify(liquidityTotalRebateUsd)
        .mul(expandDecimals(1, feeRewardToken.decimals)).div(feeRewardTokenPrice)
      liquidityReferrerAccounts.push(account)
      liquidityReferrerAmounts.push(liquidityAmount)
      totalLiquidityReferrerAmount = totalLiquidityReferrerAmount.add(liquidityAmount)
      totalLiquidityReferrerUsd = totalLiquidityReferrerUsd.add(liquidityTotalRebateUsd)
    }

    if (esfxdxRewardsUsd) {
      const esFxdxAmount = bigNumberify(esfxdxRewardsUsd).mul(expandDecimals(1, 18)).div(fxdxPrice)
      esFxdxAccounts.push(account)
      esFxdxAmounts.push(esFxdxAmount)
      totalEsFxdxAmount = totalEsFxdxAmount.add(esFxdxAmount)
    }
  }

  for (let i = 0; i < discountsData.length; i++) {
    const { account, discountUsd } = discountsData[i]
    allDiscountUsd = allDiscountUsd.add(discountUsd)
    if (account === AddressZero) { continue }

    const amount = bigNumberify(discountUsd).mul(expandDecimals(1, feeRewardToken.decimals)).div(feeRewardTokenPrice)
    discountAccounts.push(account)
    discountAmounts.push(amount)
    totalDiscountAmount = totalDiscountAmount.add(amount)
    totalDiscountUsd = totalDiscountUsd.add(discountUsd)
  }

  referrersData.sort((a, b) => {
    if (bigNumberify(a.rebateUsd).gt(b.rebateUsd)) {
      return -1;
    }
    if (bigNumberify(a.rebateUsd).lt(b.rebateUsd)) {
      return 1;
    }

    return 0;
  })

  console.log("top trade referrer", referrersData[0].account, referrersData[0].rebateUsd)

  referrersData.sort((a, b) => {
    if (bigNumberify(a.liquidityTotalRebateUsd).gt(b.liquidityTotalRebateUsd)) {
      return -1;
    }
    if (bigNumberify(a.liquidityTotalRebateUsd).lt(b.liquidityTotalRebateUsd)) {
      return 1;
    }

    return 0;
  })

  console.log("top buyFLP referrer", referrersData[0].account, referrersData[0].liquidityTotalRebateUsd)

  const totalFeeAmount = totalReferrerAmount.add(totalDiscountAmount).add(totalLiquidityReferrerAmount)
  console.log(`total referrer trade rebates (${feeRewardToken.name})`, ethers.utils.formatUnits(totalReferrerAmount, feeRewardToken.decimals))
  console.log("total referrer trade rebates (USD)", ethers.utils.formatUnits(totalReferrerUsd, 30))
  console.log("all referrer trade rebates (USD)", ethers.utils.formatUnits(allReferrerUsd, 30))
  console.log(`total trader discounts (${feeRewardToken.name})`, ethers.utils.formatUnits(totalDiscountAmount, feeRewardToken.decimals))
  console.log("total trader discounts (USD)", ethers.utils.formatUnits(totalDiscountUsd, 30))
  console.log("all trader discounts (USD)", ethers.utils.formatUnits(allDiscountUsd, 30))
  console.log(`total referrer buyFLP rebates (${feeRewardToken.name})`, ethers.utils.formatUnits(totalLiquidityReferrerAmount, feeRewardToken.decimals))
  console.log("total referrer buyFLP rebates (USD)", ethers.utils.formatUnits(totalLiquidityReferrerUsd, 30))
  console.log("all referrer buyFLP rebates (USD)", ethers.utils.formatUnits(allLiquidityReferrerUsd, 30))
  console.log(`total ${feeRewardToken.name}`, ethers.utils.formatUnits(totalFeeAmount, feeRewardToken.decimals))
  console.log(`total USD`, ethers.utils.formatUnits(totalReferrerUsd.add(totalDiscountUsd).add(totalLiquidityReferrerUsd), 30))
  console.log(`total esFxdx`, ethers.utils.formatUnits(totalEsFxdxAmount, 18))

  const batchSize = 150

  if (shouldSendTxn) {
    const feeRewardTokenContract = await contractAt("Token", feeRewardToken.address)

    const printBatch = (currentBatch) => {
      for (let i = 0; i < currentBatch.length; i++) {
        const item = currentBatch[i]
        const account = item[0]
        const amount = item[1]
        console.log(account, ethers.utils.formatUnits(amount, 18))
      }
    }

    await sendTxn(feeRewardTokenContract.approve(batchSender.address, totalFeeAmount), "feeRewardToken.approve")

    await processBatch([referrerAccounts, referrerAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(feeRewardToken.address, accounts, amounts, referrerRewardsTypeId), "batchSender.sendAndEmit(feeRewardToken, referrer trade rebates)")
    })

    await processBatch([discountAccounts, discountAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(feeRewardToken.address, accounts, amounts, traderDiscountsTypeId), "batchSender.sendAndEmit(feeRewardToken, trader discounts)")
    })

    await sendTxn(esFxdx.approve(batchSender.address, totalEsFxdxAmount), "esFxdx.approve")

    await processBatch([esFxdxAccounts, esFxdxAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(esFxdx.address, accounts, amounts, referrerRewardsTypeId), "batchSender.sendAndEmit(esFxdx, esFxdx referrer trade rewards)")
    })

    await processBatch([liquidityReferrerAccounts, liquidityReferrerAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(feeRewardToken.address, accounts, amounts, liquidityRefererRewardsTypeId), "batchSender.sendAndEmit(feeRewardToken, referrer buyFLP rebates)")
    })
  }
}

module.exports = {
  getOptimismValues,
  getOptimismGoerliValues,
  sendReferralRewards
}
