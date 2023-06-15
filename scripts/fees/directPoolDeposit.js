const { contractAt, sendTxn } = require("../shared/helpers")
const { parseValue, formatAmount } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const addresses = require('../core/addresses')[network];

function getGoerliValues() {
  // replace DIRECT_POOL_AMOUNTS values with the ones got by running calculateFeeDistribution.js
  // for the tokens that you don't want to do direct pool deposit, set "0" as their values.
  const DIRECT_POOL_AMOUNTS = {
    btc: "0.1",
    eth: "0",
    usdc: "1000",
    usdt: "1000",
  }

  // platform token array
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  return {
    directPoolAmounts: DIRECT_POOL_AMOUNTS,
    tokenArr
  }
}

function getOptimismGoerliValues() {
  // replace DIRECT_POOL_AMOUNTS values with the ones got by running calculateFeeDistribution.js
  // for the tokens that you don't want to do direct pool deposit, set "0" as their values.
  const DIRECT_POOL_AMOUNTS = {
    btc: "8.076150049427375939",
    eth: "57.186934200823460795",
    feth: "169.737586814752168843",
    usdc: "305987.259479644929221847",
    usdt: "12740.144515111490318287",
  }

  // platform token array
  const { btc, eth, feth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, feth, usdc, usdt]

  return {
    directPoolAmounts: DIRECT_POOL_AMOUNTS,
    tokenArr
  }
}

function getOptimismValues() {
  // replace DIRECT_POOL_AMOUNTS values with the ones got by running calculateFeeDistribution.js
  // for the tokens that you don't want to do direct pool deposit, set "0" as their values.
  const DIRECT_POOL_AMOUNTS = {
    btc: "0.00000375",
    eth: "0.000347021520591285",
    usdc: "0.104060",
    usdt: "0.103526",
  }

  // platform token array
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  return {
    directPoolAmounts: DIRECT_POOL_AMOUNTS,
    tokenArr
  }
}

function getValues() {
  if (network === "goerli") {
    return getGoerliValues()
  } else if (network === "optimismGoerli") {
    return getOptimismGoerliValues()
  } else if (network === "optimism") {
    return getOptimismValues()
  }
}

async function main() {
  const { directPoolAmounts, tokenArr } = getValues()

  const router = await contractAt("Router", addresses.router)

  console.log("\n----", network, "chain direct pool deposit ----\n")

  for (let i = 0; i < tokenArr.length; i++) {
    const token = await contractAt("Token", tokenArr[i].address)
    const amount = parseValue(directPoolAmounts[tokenArr[i].name], tokenArr[i].decimals)

    if (amount.eq(0)) {
      console.log("\n---->", tokenArr[i].name, ": direct pool deposit skipped. \n")
      continue
    }

    console.log("\n---->", tokenArr[i].name, ": direct pool deposit amount:", formatAmount(amount, tokenArr[i].decimals, tokenArr[i].decimals, true), "\n")

    await sendTxn(token.approve(router.address, amount), "router.approve")
    await sendTxn(router.directPoolDeposit(token.address, amount), "router.directPoolDeposit")
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
