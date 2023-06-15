const path = require("path")

const { contractAt, sendTxn, processBatch } = require("../shared/helpers")
const { expandDecimals, bigNumberify } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const addresses = require("../core/addresses")[network];

const shouldSendTxn = false

const { AddressZero } = ethers.constants

async function getOptimismGoerliValues() {
  let optimismGoerliFile
  if (process.env.OPTIMISM_GOERLI_FILE) {
    optimismGoerliFile = path.join(process.env.PWD, process.env.OPTIMISM_GOERLI_FILE)
  } else {
    optimismGoerliFile = path.join(__dirname, "../distribution-data-optimismGoerli.json")
  }
  console.log("OpitimismGoerli file: %s", optimismGoerliFile)
  const data = require(optimismGoerliFile)
  const gasLimit = 30000000
  const totalFxdx = 766
  const totalUsd = 44821

  return { data, gasLimit, totalFxdx, totalUsd }
}

async function getOptimismValues() {
  let optimismFile
  if (process.env.OPTIMISM_FILE) {
    optimismFile = path.join(process.env.PWD, process.env.OPTIMISM_FILE)
  } else {
    optimismFile = path.join(__dirname, "../distribution-data-optimism.json")
  }
  console.log("Optimism file: %s", optimismFile)

  const data = require(optimismFile)
  const gasLimit = 5000000
  const totalFxdx = 233
  const totalUsd = 13653

  return { data, gasLimit, totalFxdx, totalUsd }
}

async function getValues() {
  if (network === "optimismGeorli") {
    return getOptimismGoerliValues()
  }

  if (network === "optimism") {
    return getOptimismValues()
  }
}

async function main() {
  const { data, totalFxdx, totalUsd, gasLimit } = await getValues()
  const batchSender = await contractAt("BatchSender", addresses.batchSender)
  const fxdx = await contractAt("FXDX", addresses.fxdx)

  const referrersData = data.referrers

  console.log("referrers", referrersData.length)

  const referrerRewardsTypeId = 1

  const referrerAccounts = []
  const referrerAmounts = []

  let totalAmount = bigNumberify(0)

  for (let i = 0; i < referrersData.length; i++) {
    const { account, rebateUsd, esfxdxRewardsUsd } = referrersData[i]

    if (account === AddressZero) { continue }

    const amount = bigNumberify(rebateUsd).mul(expandDecimals(totalFxdx, 18)).div(expandDecimals(totalUsd, 30))
    referrerAccounts.push(account)
    referrerAmounts.push(amount)

    totalAmount = totalAmount.add(amount)
  }

  console.log("total amount", ethers.utils.formatUnits(totalAmount, 18))

  const batchSize = 150

  if (shouldSendTxn) {
    const printBatch = (currentBatch) => {
      for (let i = 0; i < currentBatch.length; i++) {
        const item = currentBatch[i]
        const account = item[0]
        const amount = item[1]
        console.log(account, ethers.utils.formatUnits(amount, 18))
      }
    }

    await sendTxn(fxdx.approve(batchSender.address, totalAmount, { gasLimit: 1000000 }), "fxdx.approve")

    await processBatch([referrerAccounts, referrerAmounts], batchSize, async (currentBatch) => {
      printBatch(currentBatch)

      const accounts = currentBatch.map((item) => item[0])
      const amounts = currentBatch.map((item) => item[1])

      await sendTxn(batchSender.sendAndEmit(fxdx.address, accounts, amounts, referrerRewardsTypeId, { gasLimit }), "batchSender.sendAndEmit(fxdx, referrer rewards)")
    })
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
