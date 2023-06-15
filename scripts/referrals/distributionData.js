const fs = require('fs')

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const ethers = require('ethers')

const ARBITRUM_SUBGRAPH_ENDPOINT = 'https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/gmx-arbitrum-referrals/api'
const AVALANCHE_SUBGRAPH_ENDPOINT = 'https://subgraph.satsuma-prod.com/3b2ced13c8d9/gmx/gmx-avalanche-referrals/api'
const OPTIMISM_GOERLI_SUBGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-goerli-referral2'
const OPTIMISM_SUGRAPH_ENDPOINT = 'https://api.thegraph.com/subgraphs/name/danielsmith0630/fxdx-optimism-referrals'

const BigNumber = ethers.BigNumber
const { formatUnits, parseUnits } = ethers.utils
const SHARE_DIVISOR = BigNumber.from("1000000000") // 1e9
const BONUS_TIER = 2 // for EsFXDX distributions
const LIQUIDITY_BONUS_TIER = 3 // for EsFXDX distributions
const USD_DECIMALS = 30
const FXDX_DECIMALS = 18

function stringToFixed(s, n) {
  return Number(s).toFixed(n)
}

function bigNumberify(n) {
  return ethers.BigNumber.from(n)
}

function expandDecimals(n, decimals) {
  return bigNumberify(n).mul(bigNumberify(10).pow(decimals))
}

function getSubgraphEndpoint(network) {
  return {
    avalanche: AVALANCHE_SUBGRAPH_ENDPOINT,
    arbitrum: ARBITRUM_SUBGRAPH_ENDPOINT,
    optimismGoerli: OPTIMISM_GOERLI_SUBGRAPH_ENDPOINT,
    optimism: OPTIMISM_SUGRAPH_ENDPOINT,
  }[network]
}

async function requestSubgraph(network, query) {
  const subgraphEndpoint = getSubgraphEndpoint(network)

  if (!subgraphEndpoint) {
    throw new Error("Unknown network " + network)
  }

  const payload = JSON.stringify({query})
  const res = await fetch(subgraphEndpoint, {
    method: 'POST',
    body: payload,
    headers: {'Content-Type': 'application/json'}
  })

  const j = await res.json()
  if (j.errors) {
    throw new Error(JSON.stringify(j))
  }

  return j.data
}

async function getReferrersTiers(network) {
  const data = await requestSubgraph(network, `{
    referrers(first: 1000, where: { tierId_in: ["2", "1"]}) {
      id,
      tierId
    }
  }`)

  return data.referrers.reduce((memo, item) => {
    memo[item.id] = parseInt(item.tierId)
    return memo
  }, {})
}

async function getLiquidityReferrersTiers(network) {
  const data = await requestSubgraph(network, `{
    liquidityReferrers(first: 1000, where: { tierId_in: ["2", "1"]}) {
      id,
      tierId
    }
  }`)

  return data.liquidityReferrers.reduce((memo, item) => {
    memo[item.id] = parseInt(item.tierId)
    return memo
  }, {})
}

async function saveDistributionData(network, fromTimestamp, toTimestamp, account, fxdxPrice, esfxdxRewards) {
  if (fxdxPrice) {
    fxdxPrice = parseUnits(fxdxPrice, USD_DECIMALS)
  }
  if (esfxdxRewards) {
    esfxdxRewards = parseUnits(esfxdxRewards, FXDX_DECIMALS)
  }
  let referrerCondition = ""
  let referralCondition = ""
  if (account) {
    referrerCondition = `,referrer: "${account.toLowerCase()}"`
    referralCondition = `,referral: "${account.toLowerCase()}"`
  }

  const getReferrerStatsQuery = (skip) => `referrerStats(first: 1000, skip: ${skip}, where: {
      period: daily,
      timestamp_gte: ${fromTimestamp},
      timestamp_lt: ${toTimestamp},
      ${referrerCondition}
    }) {
      id
      totalRebateUsd
      discountUsd
      liquidityTotalRebateUsd
      timestamp
      volume
      liquidityVolume
      tradedReferralsCount
      mintedReferralsCount
      trades
      mints
      referrer
    }`

    const getReferralStatsQuery = (skip) => `referralStats(first: 1000, skip: ${skip}, where: {
      period: daily,
      timestamp_gte: ${fromTimestamp},
      timestamp_lt: ${toTimestamp},
      ${referralCondition}
    }) {
      id
      discountUsd
      timestamp
      referral
      volume
      liquidityVolume
    }`

  const query = `{
    referrerStats0: ${getReferrerStatsQuery(0)}
    referrerStats1: ${getReferrerStatsQuery(1000)}
    referrerStats2: ${getReferrerStatsQuery(2000)}
    referrerStats3: ${getReferrerStatsQuery(3000)}
    referrerStats4: ${getReferrerStatsQuery(4000)}
    referrerStats5: ${getReferrerStatsQuery(5000)}

    referralStats0: ${getReferralStatsQuery(0)}
    referralStats1: ${getReferralStatsQuery(1000)}
    referralStats2: ${getReferralStatsQuery(2000)}
    referralStats3: ${getReferralStatsQuery(3000)}
    referralStats4: ${getReferralStatsQuery(4000)}
    referralStats5: ${getReferralStatsQuery(5000)}
  }`

  let [data, referrersTiers, liquidityReferrersTiers] = await Promise.all([
    requestSubgraph(network, query),
    getReferrersTiers(network),
    getLiquidityReferrersTiers(network),
  ])

  const referrerStats = [
    ...data.referrerStats0,
    ...data.referrerStats1,
    ...data.referrerStats2,
    ...data.referrerStats3,
    ...data.referrerStats4,
    ...data.referrerStats5,
  ]

  const referralStats = [
    ...data.referralStats0,
    ...data.referralStats1,
    ...data.referralStats2,
    ...data.referralStats3,
    ...data.referralStats4,
    ...data.referralStats5,
  ]

  if (referralStats.length === 6000) {
    throw new Error("Referrals stats should be paginated")
  }

  if (referrerStats.length === 6000) {
    throw new Error("Referrers stats should be paginated")
  }

  let allReferrersRebateUsd = BigNumber.from(0)
  let allLiquidityReferrersRebateUsd = BigNumber.from(0)
  let totalReferralVolume = BigNumber.from(0)
  let liquidityTotalReferralVolume = BigNumber.from(0)
  let bonusTierReferralVolume = BigNumber.from(0)
  let liquidityBonusTierReferralVolume = BigNumber.from(0)
  let totalRebateUsd = BigNumber.from(0)
  let liquidityTotalRebateUsd = BigNumber.from(0)
  const referrersRebatesData = referrerStats.reduce((memo, item) => {
    const tierId = referrersTiers[item.referrer] || 0
    const liquidityTierId = liquidityReferrersTiers[item.referrer] || 0
    memo[item.referrer] = memo[item.referrer] || {
      rebateUsd: BigNumber.from(0),
      totalRebateUsd: BigNumber.from(0),
      liquidityTotalRebateUsd: BigNumber.from(0),
      volume: BigNumber.from(0),
      liquidityVolume: BigNumber.from(0),
      tradesCount: 0,
      mintsCount: 0,
      tierId,
      liquidityTierId,
    }
    const referrerRebatesUsd = BigNumber.from(item.totalRebateUsd).sub(BigNumber.from(item.discountUsd))
    allReferrersRebateUsd = allReferrersRebateUsd.add(referrerRebatesUsd)
    allLiquidityReferrersRebateUsd = allLiquidityReferrersRebateUsd.add(BigNumber.from(item.liquidityTotalRebateUsd))
    memo[item.referrer].rebateUsd = memo[item.referrer].rebateUsd.add(referrerRebatesUsd)
    memo[item.referrer].totalRebateUsd = memo[item.referrer].totalRebateUsd.add(
      BigNumber.from(item.totalRebateUsd)
    )
    memo[item.referrer].liquidityTotalRebateUsd = memo[item.referrer].liquidityTotalRebateUsd.add(
      BigNumber.from(item.liquidityTotalRebateUsd)
    )
    memo[item.referrer].volume = memo[item.referrer].volume.add(BigNumber.from(item.volume))
    memo[item.referrer].liquidityVolume = memo[item.referrer].liquidityVolume.add(BigNumber.from(item.liquidityVolume))
    memo[item.referrer].tradesCount += Number(item.trades)
    memo[item.referrer].mintsCount += Number(item.mints)

    totalRebateUsd = totalRebateUsd.add(BigNumber.from(item.totalRebateUsd))
    liquidityTotalRebateUsd = liquidityTotalRebateUsd.add(BigNumber.from(item.liquidityTotalRebateUsd))
    totalReferralVolume = totalReferralVolume.add(BigNumber.from(item.volume))
    liquidityTotalReferralVolume = liquidityTotalReferralVolume.add(BigNumber.from(item.liquidityVolume))
    if (tierId === BONUS_TIER) {
      bonusTierReferralVolume = bonusTierReferralVolume.add(BigNumber.from(item.volume))
    }
    if (liquidityTierId === LIQUIDITY_BONUS_TIER) {
      liquidityBonusTierReferralVolume = liquidityBonusTierReferralVolume.add(BigNumber.from(item.liquidityVolume))
    }
    return memo
  }, {})

  if (allReferrersRebateUsd.eq(0) && allLiquidityReferrersRebateUsd.eq(0)) {
    console.warn("No rebates on %s", network)
    return
  }

  Object.entries(referrersRebatesData).forEach(([account, data]) => {
    data.allReferrersRebateUsd = allReferrersRebateUsd
    data.account = account
    data.share = allReferrersRebateUsd.gt(0)
      ? data.rebateUsd.mul(SHARE_DIVISOR).div(allReferrersRebateUsd)
      : bigNumberify(0)
    data.liquidityRebateShare = allLiquidityReferrersRebateUsd.gt(0)
      ? data.liquidityTotalRebateUsd.mul(SHARE_DIVISOR).div(allLiquidityReferrersRebateUsd)
      : bigNumberify(0)
  })
  if (fxdxPrice && esfxdxRewards) {
    const esfxdxRewardsUsdLimit = esfxdxRewards.mul(fxdxPrice).div(expandDecimals(1, FXDX_DECIMALS))
    let esfxdxRewardsUsdTotal = BigNumber.from(0)
    Object.values(referrersRebatesData).forEach(data => {
      if (data.tierId !== BONUS_TIER) {
        return
      }
      data.esfxdxRewardsUsd = data.volume.mul(15).div(10000).div(20) // 0.15% base position fee, 0.05% of fee is EsFXDX bonus rewards
      data.esfxdxRewards = data.esfxdxRewardsUsd
        .mul(expandDecimals(1, USD_DECIMALS))
        .div(fxdxPrice)
        .div(expandDecimals(1, 12))
      esfxdxRewardsUsdTotal = esfxdxRewardsUsdTotal.add(data.esfxdxRewardsUsd)
    })

    if (esfxdxRewardsUsdTotal.gt(esfxdxRewardsUsdLimit)) {
      const denominator = esfxdxRewardsUsdTotal.mul(USD_DECIMALS).div(esfxdxRewardsUsdLimit)
      Object.values(referrersRebatesData).forEach(data => {
        data.esfxdxRewardsUsd = data.esfxdxRewardsUsd.mul(USD_DECIMALS).div(denominator)
        data.esfxdxRewards = data.esfxdxRewardsUsd
          .mul(expandDecimals(1, USD_DECIMALS))
          .div(fxdxPrice)
          .div(expandDecimals(1, 12))
      })
    }
  }

  const output = {
    fromTimestamp,
    toTimestamp,
    network,
    totalReferralVolume: totalReferralVolume.toString(),
    liquidityTotalReferralVolume: liquidityTotalReferralVolume.toString(),
    totalRebateUsd: totalRebateUsd.toString(),
    liquidityTotalRebateUsd: liquidityTotalRebateUsd.toString(),
    shareDivisor: SHARE_DIVISOR.toString(),
    referrers: [],
    referrals: [],
    fxdxPrice,
    esfxdxRewards
  }
  console.log("\nTrade Total referral volume: %s ($%s)",
    totalReferralVolume.toString(),
    Number(formatUnits(totalReferralVolume, USD_DECIMALS)).toFixed(4)
  )
  console.log("\nLiquidity Total referral volume: %s ($%s)",
    liquidityTotalReferralVolume.toString(),
    Number(formatUnits(liquidityTotalReferralVolume, USD_DECIMALS)).toFixed(4)
  )
  console.log("Total base fees collected from referral traders: %s ($%s)",
    totalReferralVolume.mul(15).div(10000).toString(),
    Number(formatUnits(totalReferralVolume.mul(15).div(10000), USD_DECIMALS)).toFixed(4)
  )
  console.log("Trade Total rebates (for Referrers + Traders): %s ($%s)",
    totalRebateUsd.toString(),
    Number(formatUnits(totalRebateUsd, USD_DECIMALS)).toFixed(4)
  )
  console.log("Liquidity Total rebates (for Referrers): %s ($%s)",
    liquidityTotalRebateUsd.toString(),
    Number(formatUnits(liquidityTotalRebateUsd, USD_DECIMALS)).toFixed(4)
  )

  console.log("\nReferrers (Referrers):")
  console.log("Rebates sum: %s ($%s)",
    allReferrersRebateUsd.toString(),
    Number(formatUnits(allReferrersRebateUsd, USD_DECIMALS)).toFixed(4)
  )
  let consoleData = []
  for (const data of Object.values(referrersRebatesData)) {
    if (data.share.eq(0) && data.liquidityRebateShare.eq(0)) {
      continue
    }
    consoleData.push({
      referrer: data.account,
      "trade rebates share, %": stringToFixed(formatUnits(data.share, 7), 4),
      "buyFLP rebates share, %": stringToFixed(formatUnits(data.liquidityRebateShare, 7), 4),
      "volume, $": stringToFixed(formatUnits(data.volume, USD_DECIMALS), 4),
      "liquidityVolume, $": stringToFixed(formatUnits(data.liquidityVolume, USD_DECIMALS), 4),
      "trade rebateUsd, $": stringToFixed(formatUnits(data.rebateUsd, USD_DECIMALS), 4),
      "buyFLP rebateUsd, $": stringToFixed(formatUnits(data.liquidityTotalRebateUsd, USD_DECIMALS), 4),
      trades: data.tradesCount,
      mints: data.mintsCount,
      tierId: data.tierId,
      liquidityTierId: data.liquidityTierId,
      "esfxdxRewards, $": data.esfxdxRewardsUsd ? formatUnits(data.esfxdxRewardsUsd, USD_DECIMALS) : null,
      esfxdxRewards: data.esfxdxRewards ? formatUnits(data.esfxdxRewards, FXDX_DECIMALS) : null,
    })
    output.referrers.push({
      account: data.account,
      share: data.share.toString(),
      liquidityRebateShare: data.liquidityRebateShare.toString(),
      volume: data.volume.toString(),
      liquidityVolume: data.liquidityVolume.toString(),
      tradesCount: data.tradesCount,
      mintsCount: data.mintsCount,
      rebateUsd: data.rebateUsd.toString(),
      totalRebateUsd: data.totalRebateUsd.toString(),
      liquidityTotalRebateUsd: data.liquidityTotalRebateUsd.toString(),
      tierId: data.tierId,
      liquidityTierId: data.liquidityTierId,
      esfxdxRewards: data.esfxdxRewards ? data.esfxdxRewards.toString() : null,
      esfxdxRewardsUsd: data.esfxdxRewardsUsd ? data.esfxdxRewardsUsd.toString() : null,
    })
  }
  console.table(consoleData)

  let allReferralsDiscountUsd = BigNumber.from(0)
  const referralDiscountData = referralStats.reduce((memo, item) => {
    memo[item.referral] = memo[item.referral] || {
      discountUsd: BigNumber.from(0),
      volume: BigNumber.from(0),
      liquidityVolume: BigNumber.from(0),
    }
    memo[item.referral].discountUsd = memo[item.referral].discountUsd.add(BigNumber.from(item.discountUsd))
    memo[item.referral].volume = memo[item.referral].volume.add(BigNumber.from(item.volume))
    memo[item.referral].liquidityVolume = memo[item.referral].liquidityVolume.add(BigNumber.from(item.liquidityVolume))
    allReferralsDiscountUsd = allReferralsDiscountUsd.add(BigNumber.from(item.discountUsd))
    return memo
  }, {})

  Object.entries(referralDiscountData).forEach(([account, data]) => {
    data.allReferralsDiscountUsd = allReferralsDiscountUsd
    data.account = account
    data.share = data.discountUsd.mul(SHARE_DIVISOR).div(allReferralsDiscountUsd)
  })

  console.log("Referrals (Traders):")
  console.log("Discount sum: %s ($%s)",
    allReferralsDiscountUsd.toString(),
    Number(formatUnits(allReferralsDiscountUsd, USD_DECIMALS)).toFixed(4)
  )
  consoleData = []
  for (const data of Object.values(referralDiscountData)) {
    if (data.share.eq(0)) {
      continue
    }
    consoleData.push({
      referral: data.account,
      "share, %": stringToFixed(formatUnits(data.share, 7), 4),
      "volume, $": stringToFixed(formatUnits(data.volume, USD_DECIMALS), 4),
      "liquidityVolume, $": stringToFixed(formatUnits(data.liquidityVolume, USD_DECIMALS), 4),
      "discountUsd, $": stringToFixed(formatUnits(data.discountUsd, USD_DECIMALS), 4),
    })
    output.referrals.push({
      account: data.account,
      share: data.share.toString(),
      discountUsd: data.discountUsd.toString(),
      volume: data.volume.toString(),
      liquidityVolume: data.liquidityVolume.toString(),
    })
  }
  console.table(consoleData)

  const filename = `./distribution-data-${network}.json`
  fs.writeFileSync(filename, JSON.stringify(output, null, 4))
  console.log("Data saved to: %s", filename)
}

module.exports = {
  saveDistributionData
}
