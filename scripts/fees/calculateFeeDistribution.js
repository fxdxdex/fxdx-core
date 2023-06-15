const { contractAt } = require("../shared/helpers")
const { expandDecimals, bigNumberify, formatAmount, parseValue } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('../core/tokens')[network];
const addresses = require('../core/addresses')[network];

const BASIS_POINTS_DIVISOR = 10000
const USD_DECIMALS = 30

function getGoerliValues() {
  // update the following 3 BPS values according to your need.
  // sum of the following 3 values should be equal to BASIS_POINTS_DIVISIOR
  const MAINTENENCE_BPS = 100 // 1%
  const DIRECT_POOL_BPS = 2900 // 29%
  const REWARDS_BPS = 7000 // 70%

  // replace the TOKEN_FEES values with the ones got by running withdrawFees script
  const TOKEN_FEES = {
    "btc": "0.000000000000000000",
    "eth": "0.000000000000000000",
    "usdc": "0.000000000000000000",
    "usdt": "0.000000000000000000"
  }

  // replace WITHDRAW_TIMESTAMP value with the one printed by running withdrawFees script (-> Timestamp: )
  const WITHDRAW_TIMESTAMP = 0

  // platform index tokens
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  return {
    maintenanceBps: MAINTENENCE_BPS,
    directPoolBps: DIRECT_POOL_BPS,
    tokenFeesMap: TOKEN_FEES,
    timestamp: WITHDRAW_TIMESTAMP,
    tokenArr
  }
}

function getOptimismGoerliValues() {
  // update the following 3 BPS values according to your need.
  // sum of the following 3 values should be equal to BASIS_POINTS_DIVISIOR
  const MAINTENENCE_BPS = 100 // 1%
  const DIRECT_POOL_BPS = 2900 // 29%
  const REWARDS_BPS = 7000 // 70%

  // replace the TOKEN_FEES values with the ones got by running withdrawFees script
  const TOKEN_FEES = {
    "btc": "27.848793273887503241",
    "eth": "197.196324830425726880",
    "feth": "585.302023499145409805",
    "usdc": "1055128.480964292859385680",
    "usdt": "43931.532810729276959612"
  }

  // replace WITHDRAW_TIMESTAMP value with the one printed by running withdrawFees script (-> Timestamp: )
  const WITHDRAW_TIMESTAMP = 1686637388

  // platform index tokens
  const { btc, eth, feth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, feth, usdc, usdt]

  return {
    maintenanceBps: MAINTENENCE_BPS,
    directPoolBps: DIRECT_POOL_BPS,
    tokenFeesMap: TOKEN_FEES,
    timestamp: WITHDRAW_TIMESTAMP,
    tokenArr
  }
}


function getOptimismValues() {
  // update the following 3 BPS values according to your need.
  // sum of the following 3 values should be equal to BASIS_POINTS_DIVISIOR
  const MAINTENENCE_BPS = 0 // 1%
  const DIRECT_POOL_BPS = 0 // 29%
  const REWARDS_BPS = 10000 // 70%

  // replace the TOKEN_FEES values with the ones got by running withdrawFees script
  const TOKEN_FEES = {
    "btc": "0.00116263",
    "eth": "0.051032296583732714",
    "usdc": "107.095633",
    "usdt": "35.034876"
  }

  // replace WITHDRAW_TIMESTAMP value with the one printed by running withdrawFees script (-> Timestamp: )
  const WITHDRAW_TIMESTAMP = 1686566391

  // platform index tokens
  const { btc, eth, usdc, usdt } = tokens
  const tokenArr = [btc, eth, usdc, usdt]

  return {
    maintenanceBps: MAINTENENCE_BPS,
    directPoolBps: DIRECT_POOL_BPS,
    tokenFeesMap: TOKEN_FEES,
    timestamp: WITHDRAW_TIMESTAMP,
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

  const {maintenanceBps, directPoolBps, tokenFeesMap, timestamp, tokenArr} = getValues()

  const vault = await contractAt("Vault", addresses.vault)
  const vaultPriceFeed = await contractAt("VaultPriceFeed", await vault.priceFeed())

  let totalUsd = bigNumberify(0)

  console.log("\n----", network, "chain fee distribution ----")
  console.log("-> Timestamp:", timestamp, "\n")

  for (let i = 0; i < tokenArr.length; i++) {
    const feeReserve = parseValue(tokenFeesMap[tokenArr[i].name], tokenArr[i].decimals)
    const minPrice = await vaultPriceFeed.getPrice(tokenArr[i].address, false, false, false)
    const maxPrice = await vaultPriceFeed.getPrice(tokenArr[i].address, true, false, false)
    const price = minPrice.add(maxPrice).div(2)
    const feeUsd = feeReserve.mul(price).div(expandDecimals(1, tokenArr[i].decimals))
    totalUsd = totalUsd.add(feeUsd)

    const maintenance = feeReserve.mul(maintenanceBps).div(BASIS_POINTS_DIVISOR)
    const direct_pool = feeReserve.mul(directPoolBps).div(BASIS_POINTS_DIVISOR)
    const rewards = feeReserve.sub(maintenance).sub(direct_pool)

    console.log(`\n-> ${tokenArr[i].name} fees:`)
    console.log('   * total       :', formatAmount(feeReserve, tokenArr[i].decimals, tokenArr[i].decimals, true))
    console.log('   * total in USD:', formatAmount(feeUsd, USD_DECIMALS, USD_DECIMALS, true))
    console.log(`   ** maintenance:`, formatAmount(maintenance, tokenArr[i].decimals, tokenArr[i].decimals, true))
    console.log(`   ** direct pool:`, formatAmount(direct_pool, tokenArr[i].decimals, tokenArr[i].decimals, true))
    console.log(`   ** rewards    :`, formatAmount(rewards, tokenArr[i].decimals, tokenArr[i].decimals, true))
  }

  console.log("\n-> Total fees in USD:", formatAmount(totalUsd, USD_DECIMALS, USD_DECIMALS, true))
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
